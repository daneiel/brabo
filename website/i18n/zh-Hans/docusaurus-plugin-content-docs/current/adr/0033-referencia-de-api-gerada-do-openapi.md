---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0033 — API 参考由代码产出，表格测试对元数据提出要求

## 背景 {#contexto}

api 暴露 **23 个 controller 中的 118 条路由**，而到目前为止唯一的合约文档是 `docs/security-surface.md`。它回答每条路由*谁可以调用*——却对路由做什么、接受什么或返回什么只字不提。做集成的人只能读 controller。

7.1 开了先例：两个认证 controller 诞生时就带着
`@ApiTags`/`@ApiOperation`/`@ApiProperty`，`auth/dto/auth.dto.ts` 的文件头记录了意图——*"os decorators entram AGORA, junto com as rotas, e não
numa varredura retroativa"*。本次交付就是那条注释承诺不再需要的追溯式扫描，也是让它成为最后一次的机制。

`@nestjs/swagger` 自 7.1 起已是依赖，但 `SwaggerModule` 在任何地方都没有接上：文档并不存在。

探查中的三个发现在写下一行代码之前就重新设计了这次交付：

1. **没有任何 decorator 时，`@nestjs/swagger` 会**合成**一个响应。** `api-response.explorer.js` 对每个没有 `@ApiResponse` 的 handler 返回 `{ '<status>': { description: '' } }`。在本阶段之前，**118 条路由中有 111 条**正处于这种状态。显而易见的断言——*“每条路由都有一个 2xx 响应”*——会在什么都没验证的情况下变绿。
2. **只要存在任何 `@ApiResponse`，`@HttpCode` 就会被忽略。** 文档化的 status 只来自 decorator。这个缺陷早已存在于仓库中：`POST /auth/register` 和 `POST /auth/request-password-reset`
   有 `@HttpCode(202)` 配 `@ApiOkResponse`，而文档声称是 200。
3. **在 auth 之外，没有任何 handler 声明返回类型。** 模式是
   `return this.useCase.execute(...)`，它解析为 `src/domain/**` 中的*接口*和*类型别名*——`@nestjs/swagger` 无法从中推导 schema，并且会对它们输出 `{}` 而**不发出警告**。

## 决策 {#decisão}

**参考由 OpenAPI 生成，从不手写**，第 5 阶段的表格测试开始对喂给它的元数据提出要求。

### 响应 DTO 按**类型**镜像实体 {#os-dtos-de-resposta-espelham-a-entidade-por-tipo}

存在约 55 种不同的响应形态（不是 118：`ProposedAction` 服务 6 条路由，`Session` 5 条）。每一种都成为
`interfaces/http/<domínio>/dto/*.response.dto.ts` 中的一个类。`src/domain/**` 中没有任何东西被改动——在实体上加 `@ApiProperty` 有损领域的纯粹性。

写 DTO 是容易的部分。风险在于实体新增了字段而 DTO 没有的那一天：参考开始**静默**地撒谎。针对这一点有两道类型锁，两道都必要：

```ts
export class SessionResponseDto implements Wire<Session> { … }
export const _chavesSession: MesmasChaves<SessionResponseDto, Session> = true;
```

直接 `implements Session` 不行：实体说 `createdAt: Date`，而 JSON 正文说 `string`。`Wire<T>` 是实体**在线上传输时的样子**，这样 `implements` 才是诚实的。但 `implements` 是单向的——它对**多出的字段视而不见**，一个描述已删除字段的 DTO 会永远编译通过。`MesmasChaves` 封住这一侧。

在其上编写任何 DTO 之前，四种失败模式都经过执行验证：

| 错误 | 由谁捕获 |
|---|---|
| 实体新增了字段 | `implements`——TS2420 |
| DTO 在线上为 `string` 的地方用了 `Date` | `implements`——TS2416 |
| DTO 有实体已不再有的字段 | `MesmasChaves`——TS2322，且**只有**它 |
| 正确的 DTO | 干净编译 |

执行这些锁的是 `tsc`，而不是 vitest——后者通过 SWC 转译且不做任何类型检查。于是 CI 中新增了 `pnpm --filter api typecheck`：没有它，证明只会在镜像 job 中运行，晚二十分钟。

### 表格测试检查的是**文档**，而不是 decorator {#o-teste-de-tabela-cobra-o-documento-não-os-decorators}

`route-surface.spec.ts` 增加了七条断言，全部针对由 `SwaggerModule.createDocument` 组装的文档——与发布到站点的是同一份。逐个 handler 反射 `DECORATORS.API_RESPONSE` 测试的会是一个中间步骤：一个指向接口的 `type:` 会通过 decorator 检查，却在文档中产出 `{}`。

响应断言要求**已解析的内容或非空的描述**，而不仅仅是存在一个 2xx 键——正是上面的发现 1 迫使如此。status 断言从 `HTTP_CODE_METADATA` 重新计算真实值，这封住了发现 2。最后一条把文档与**真实的 guard** 绑定：`@Public()` 路由不能声明 `security`，需要认证的路由必须声明。没有它，参考可能声称一条路由是开放的而 guard 却把它关闭——恰恰错在代价高昂的地方。

把一条路由排除在参考之外需要在 `EXCLUIDAS_DA_REFERENCIA` 中有一条记录，没有 JSON 正文的路由需要在 `SEM_CORPO_JSON` 中有一条记录，**并附带自己的义务**（SSE 声明 `text/event-stream`，重定向声明 `Location` header，204 声明 204）。否则 `@ApiExcludeEndpoint()` 会成为逃避一切的捷径，而“这是一个流”会成为什么都不文档化的许可。

### `--check` 使用清单，而不是重新生成 {#o---check-usa-um-manifesto-não-regera}

`pnpm docs:check` 承诺不写入。为了比较而运行 `gen-api-docs` 会打破这一承诺。这道锁是一份清单，包含每个生成文件的 sha256 以及产出它们的 `openapi.json` 的 sha256，由与其他所有生成文件相同的
`escrever()` 写入——因此在 check 中行为相同。

它能捕获四种重要的漂移：手工编辑的 MDX、旧 MDX 对新 spec、缺失的生成文件和孤立文件。其中三种经过执行验证。

`openapi.json` 的排序是固定的（paths、动词、schemas、tags、status），因为 Nest 给出的顺序来自模块注册的顺序：不规范化的话，在 `AppModule` 中移动一行 `import` 会产生数千行 diff，而可预见的下一步就是有人关掉 check。

### Swagger UI 不在生产环境 {#swagger-ui-fora-de-produção}

`/docs` 和 `/docs-json` 只在 `NODE_ENV !== 'production'` 时存在。生产环境的参考是 docs 站点，由同一份文档生成；在真实环境中提供整个暴露面没有任何增益，反而免费给探测者送上地图。

## 后果 {#consequências}

参考有 118 页，每条路由一页，按 tag 分组。概览——认证、错误约定、速率限制——来自 `info.description`，因此由单一来源生成，而不是写在一个会产生分歧的 `.md` 中。

**没有元数据的新路由进不来。** 这是 docmap 所没有的反漂移机制：docmap 在文件变化时触发，但看不到诞生时就没有文档的新路由。

### 扫描顺带修正了什么 {#o-que-a-varredura-corrigiu-no-caminho}

不只是文档：

- `PUT /projects/:id/agent-autonomy` 和 `DELETE /projects/:id/members/:userId`
  返回 **200 且正文为空**。web 的 `api-client.ts` 只把 204 视为“无正文”，于是落入 `res.json()`，抛出 `SyntaxError`。两者都改为
  `@HttpCode(204)`。
- `UpdateWorkspaceDto` 和 `UpdateProjectDto` 使用
  `@nestjs/mapped-types` 的 `PartialType`，它只复制验证：两者在文档中会**没有任何属性**。
- `GitController` 上类级别的 `@ApiBearerAuth` 泄漏到了 OAuth 回调，而后者是 `@Public()`——参考声称浏览器需要令牌才能从 provider 返回。`@nestjs/swagger` 没有任何 decorator 能清除继承的要求，因此声明改为按路由进行。
- auth 中两个被记录为 200 的 `@HttpCode(202)`。

### 接受的代价 {#custos-aceitos}

- **2,7 MB 受版本控制的生成文件**（117 个 MDX 加上它们 `require()` 的 352 个 JSON）。否则 docmap 会有一条死规则，`git ls-files` 什么也看不到。
- **没有按语言的代码片段。** `postman-code-generators` 在 postinstall 中运行嵌套的 `npm install`——在我们的安装过程中访问网络，这正是第 5 阶段的纪律所拒绝的。它以 `false` 进入 `allowBuilds`。
- **`outputDir` 会被 `clean-api-docs` 整个删除**，因此 spec 放在上一层。一个删除自身输入的生成器第一次运行能成功，第二次就失败。
- **生成的侧边栏 id 深了一层**，因为插件假设 `outputDir` 在站点内部。修正位于手写的 `sidebars.ts` 中，而不是重写生成文件——改动它会让 `docs:check` 每一轮都报告漂移。

### 仍然开放的 {#o-que-continua-aberto}

`engine_api_client.ex` 仍然**没有自动检查**它是否与 api 的路由一致。参考给了两端同一个用于核对的来源，`internal-api.md` 的 `TODO(humano)` 依然有效：真正能关闭它的是从 `openapi.json` 生成 Elixir 客户端，或者两端之间的合约测试。

同样不在范围内：为 web 生成 TS 客户端（`api-client.ts` 仍为手写）、api 版本化，以及删除脚手架中的 `GET /`——它获得了带理由的 `@ApiExcludeEndpoint()` 而不是消失，因为删除它是产品决定。

引用 [ADR 0027](0027-fase5-backup-hardening-release.md)，它创建了表格测试；以及 [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md)，最早的 decorator 在那里加入。

---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0116 — `ActionType`（以及将来的类型）由 OpenAPI 契约生成，而不是手工复制

- **状态：** 已接受
- **日期：** 2026-08-28
- **背景：** 偿还 `docs/architecture.md` 中点名的技术债务（"The
  `ActionType` union is a copy, and a copy ages"），并在 `docs/explanation/backlog.md` 中跟踪；这个联合类型已经在生产中两次与后端产生分歧
- **不取代：** `apps/web/src/lib/api-types.ts`——其大部分仍然是手写的；见决策第 3 项

## 背景 {#contexto}

`apps/web/src/lib/api-types.ts`（约 1600 行）有意手工镜像 `apps/api/src/domain/**` 的实体：`apps/web` 不依赖服务端代码，文件自己的文件头也这样说。对文件的大部分内容而言，这是正确的选择——它们是小而稳定、符合 UI 形态的类型。但对于一个特定类型，这是**错误**的选择：`ActionType`。

`ActionType`（`apps/api/src/domain/actions/decide.ts`，`ACTION_TYPES`）并不是 UI 形态的——它是 `decide()` 做 `switch` 所依据的穷举列表，下游的每一个使用者（`ApprovalCard`、`lib/aprovacoes.ts` 的 `VERBO_DA_ACAO`/`FRASE_DA_ACAO` 记录）都需要它是完整的，否则就会静默降级。它与 `api-types.ts` 中手工复制的联合类型在生产中**两次**产生分歧，两次编译器都没有察觉，因为 `apps/api` 不是 `apps/web` 的依赖：

1. Gitflow 引导的三个类型（`git_repo_create`、`git_branch_create`、`git_branch_protect`）在 web 的联合类型中缺失。`ApprovalCard` 的 `ACTION_ICON[actionType]` 对它们返回 `undefined`，并让整个会话界面崩溃——每个针对真实 provider 引导过的项目都有一个打不开的会话。
2. `parallelize`/`raise_max_parallel` 在 FASE 14d 中发布，没有人记得把它们加到 web 的副本中。

如今唯一能捕获这一点的是 `apps/web/src/lib/aprovacoes.test.ts`，它在测试时读取 `decide.ts` 的源文本，并对没有句子的类型判定失败。这是一张真实的安全网，但它是运行时的，在 `pnpm test` 中才发现，而不是编译器在每次编辑时强制的结构性保障。

另外，`apps/api/src/scripts/export-openapi.ts` 早已导出完整的 OpenAPI 文档，而 `docs/reference/openapi.json` 早已是带有漂移检查的生成产物（`docs/.docmap.yml`，规则 `referencia-openapi`；`docs:generate`/`docs:check`）。`ACTION_TYPES` 早已在其中作为真正的 JSON Schema `enum` 暴露——三个 DTO（`ProposeActionDto`、`CreateActionInternalDto`、`ProposedActionResponseDto`）在 `actionType` 字段上声明 `@ApiProperty({ enum: ACTION_TYPES })`，所以这 17 个值已经经由 web 在其他一切方面都必须信任的契约走了一圈。

## 决策 {#decisão}

### 1. `openapi-typescript`（`^7.13.0`）从 `docs/reference/openapi.json` 生成 `apps/web/src/lib/api-types.generated.ts` {#1-openapi-typescript-7130-gera-appswebsrclibapi-typesgeneratedts-a-partir-de-docsreferenceopenapijson}

选择它而不是手写生成器，因为把 JSON Schema 的 `enum`（以及，如果文件增长，整套请求/响应的形态）转换为 TypeScript 联合类型，正是这个库所解决的问题，而它是这件事的事实标准——这就是 `CLAUDE.md` 规则要求说明理由的"重型依赖"，而理由是上面两次生产事故，而不是便利。

输入是**已提交**的 `docs/reference/openapi.json`，而不是串联起来新跑一次 `export-openapi.ts`。该文件已经有被强制的新鲜度不变量（`docs:generate --check`，在 `.github/workflows/docs-check.yml` 的 `guardiao` job 中运行）——从 `apps/web` 读取实时导出意味着要从一个既不依赖 NestJS、也没有理由去依赖它的包中启动整个 `AppModule`，只为重新推导一项就在隔壁已经存在的保证。

两个 npm 脚本，放在 `apps/web/package.json`（而不是 `apps/api`）：由**使用者**决定何时重新生成，而来源是仓库中已有的文件，而不是 api 的活进程——`apps/web` 需要 api 的开发服务器运行着才能拿到自己的类型，将是比本 ADR 移除的依赖更糟的依赖。

- `openapi:types` — 写入 `src/lib/api-types.generated.ts`。
- `openapi:types:check` — 库原生的 `--check` 模式：重新计算并比较，从不写入。连接在 `docs-check.yml` 中、紧跟在已有的 `openapi.json` 新鲜度步骤之后，并依赖它先运行——这里的 `--check` 只有在已知 `openapi.json` 是最新的时候才可靠。

### 2. `docs/reference/openapi.json` 的新鲜度关口：复用，不重复 {#2-portão-de-frescor-do-docsreferenceopenapijson-reusado-não-duplicado}

`docs/.docmap.yml` 的 `referencia-openapi` 规则早已监视每个 DTO 和 controller，并要求 `openapi.json`/MDX 清单随它们一起变化。`apps/web/src/lib/api-types.generated.ts` 被加入**同一**规则的 `docs:` 列表，而不是新建一条复制同样 `watch:` 的规则——它是**从** `openapi.json` 由同一个触发条件生成的，第二条规则只会与第一条的 glob 列表产生分歧。

### 3. 本次改动只迁移 `ActionType`——而不是其他约 1600 行 {#3-só-actiontype-migra-nesta-mudança--não-as-outras-1600-linhas}

`api-types.ts` 自己的文件头已经划出了真正的界线：api 与 web 之间真正共享的类型（`HealthStatus`、`GitProviderName`）位于 `packages/shared`，不在这里；文件其余部分都是手工维护的领域实体镜像。一次性重新生成整个文件、而不逐个使用者检查，正是 `CLAUDE.md` 所警告的那类改动（"Não refatorar código de fase concluída sem pedido explícito"），而且作用于没人为这个 PR 重读过的 1600 行。`ActionType` 是唯一一个因手工复制而有已证实、反复出现的生产代价的类型；它被迁移。`api-types.ts` 的其余行保持不动，继续手写，将来在 PR 中像这次一样逐个类型重新评估。

`api-types.ts` 现在这样写：

```ts
import type { components } from './api-types.generated';

export type ActionType =
  components['schemas']['ProposedActionResponseDto']['actionType'];
```

选择 `ProposedActionResponseDto` 而不是 `ProposeActionDto` / `CreateActionInternalDto`（它们声明了同样的 17 值枚举），是因为它是 web 在每个审批界面中实际读取的响应形态；三者今天是同一个联合类型，而 NestJS Swagger 不会发出一个单独命名的 `ActionType` schema 来指向——它按 DTO 内联枚举，因为三者都没有使用 `@ApiExtraModels`/共享的枚举名。在 OpenAPI 文档中全局命名该枚举是将来的工作，这次修正并不需要：`ProposedActionResponseDto` 的 `actionType` 是一个简单的字符串字面量联合，在结构上与它所替换的类型完全相同。

### 4. `aprovacoes.test.ts`（FASE 19）保留——它的工作变了，并没有消失 {#4-aprovacoestestts-fase-19-fica--o-trabalho-dele-mudou-não-sumiu}

这个测试做两件事：证明后端的每个 `ActionType` 都有动词/句子条目（**存在性**），并证明该条目不为空、是葡萄牙语、标点正确（**内容**）。存在性现在也被编译器捕获——一旦 `api-types.generated.ts` 中某个值缺少键，`lib/aprovacoes.ts` 中的 `Record<ActionType, string>` 就会立刻编译失败，早于 `pnpm test` 运行。这使测试的存在性检查与一项更强、更早的保证**重复**——但它的内容断言（句子长度、句号、没有原始 `snake_case` 泄漏进葡萄牙语散文）不是类型系统会核对的东西，依然和以前一样有价值。删除测试等于把腰带加背带换成没有背带；它保留下来，并在此记录为部分被取代，而不是因惯性被默默保留。

## 后果 {#consequências}

**有利**

- 两次打到生产的缺陷类别（`ApprovalCard` 遇到 web 不认识的 `ActionType` 而崩溃）现在由 `tsc` 捕获，在每个触及 `decide.ts` 并重新生成 `openapi.json` 的 PR 中——而不是在线上被发现。
- `docs-check.yml` **大声**失败（`::error::`），并给出要运行的确切命令，与仓库中其他所有生成产物的体验相同。
- HTTP 契约、DTO 或运行时行为没有任何变化——这是只涉及类型、发生在开发时的改动。

**不利**

- `apps/web` 多了第二个 devDependency 面（`openapi-typescript`），只用于代码生成；它永远不会进入浏览器 bundle（`api-types.generated.ts` 是源码，不是库本身）。
- `api-types.generated.ts` 约有 1.8 万行（**整个** OpenAPI 面，所有路径和 DTO），尽管今天只从中使用一个类型——如果它成为真正的成本，`--root-types`/schema 过滤可以在以后把它缩小（它不在运行时加载；它是 `.d.ts` 格式的源文件，`tsc` 会读取，vite 从不打包）。
- 对于一个类型，`api-types.ts` 现在是再导出而不是定义——读者要多跟一跳（`api-types.ts` →
  `api-types.generated.ts` → `openapi.json` → `decide.ts`）才能找到事实来源。`api-types.ts` 中 import 处的注释正是为此点名了这条链上的每一环。

## 考虑过的替代方案 {#alternativas-consideradas}

**在一个 PR 中从 OpenAPI 文档重新生成整个 `api-types.ts`。** 被拒绝——文件不是纯粹的实体镜像（`packages/shared` 已经分出了真正共享的东西），不追踪约 1600 行中每一行到其使用者就整块替换，会冒无人审查的静默形态变化的风险。逐个类型迁移、从代价已证实的那个开始，更慢，但每一步都可核查。

**从 `export-openapi.ts` 的实时运行而不是已提交的 `openapi.json` 生成。** 在第 1 项中被拒绝——这会要求 `apps/web` 依赖 `apps/api` 的 NestJS 运行时或通过 shell 调用它，只为重新推导 `docs:check` 已经免费提供的新鲜度保证。

**既然编译器覆盖了穷举性，就删除 `aprovacoes.test.ts`。** 在第 4 项中被拒绝——内容断言（句子质量）不是类型层面的性质，删除文件也会删除解释**为什么**存在"每种类型一句话"这条规则的注释（RN-096）。

## 参考 {#referências}

- `apps/api/src/domain/actions/decide.ts` — `ACTION_TYPES`，规范来源
- `apps/web/src/lib/api-types.ts` — 再导出，以及点名整条链的注释
- `apps/web/src/lib/aprovacoes.ts` / `aprovacoes.test.ts` — 其穷举性现在由编译器核对的使用者
- `docs/.docmap.yml`，规则 `referencia-openapi` — 共享的新鲜度关口
- `.github/workflows/docs-check.yml` — `openapi:types:check`，连接在 `openapi.json` 新鲜度步骤之后
- `docs/architecture.md` — "The `ActionType` union is a copy, and a copy
  ages"
- [RN-096](../business-rules.md#rn-096) — 每个 `ActionType` 都需要一句葡萄牙语句子

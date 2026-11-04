---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0121 — schema 按领域聚合拆分，置于一个 barrel 之后

- **状态：** 已接受
- **日期：** 2026-08-29
- **参考（不编辑）：** [ADR 0038](0038-hierarquia-de-agentes.md) 和 [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)（本次拆分所镜像的聚合边界）、[ADR 0117](0117-lockfile-proprio-para-o-website.md)（同样的推理方式：当共享之物收取一个无人选择支付的代价时，一条边界就值得划）。

## 背景 {#contexto}

`apps/api/src/db/schema.ts` 有 2 452 行，含 **51 个 `pgTable` 声明和 34 个 `pgEnum` 声明**——从 `users` 到 `huggingface_model_pull_requests`，从 event log 到 RAG 的 chunk，全都在里面。

这早已是声明过的技术债务。`docs/architecture.md` 的债务表从诞生起就有一行写它："o arquivo mais alterado do repo … concentra as tabelas num arquivo só"，后果就写在那一行里——**第二个协作者同时修改 schema 必然冲突**，因为每一次 schema 改动都落在同一个文件中，无论属于产品的哪个部分。那一行的数字（35 张表）已经落后了 16 张表，这本身就是证据：文件增长得比描述它的段落还快。

三项具体代价，没有一项是假设的：

1. **合并两个 schema 改动总是文本冲突**，即使两者位于毫不相干的聚合中——一个认证的列和一个 backlog 的约束彼此毫无关系，却仍然在同一个 hunk 中相遇。
2. **对 schema 使用 `git log --follow` 没有用。** 文件的历史是产品每个领域历史的并集，所以"`chunks` 什么时候改的、为什么"需要阅读关于 `refresh_tokens` 的提交。
3. **阅读它需要知道往哪里滚动。** 文件内部早已用 `// --- section ---` 注释组织，这些注释点名了产品的各个领域——拆分没有发明分类法，只是把文件早已手工维护的分类提升了一级。

## 决策 {#decisão}

### 1. 每个领域聚合一个文件，位于 `apps/api/src/db/schema/` {#1-um-arquivo-por-agregado-de-domínio-em-appsapisrcdbschema}

分组**镜像 `apps/api/src/domain/*`**，即代码早已承诺的聚合边界。没有新的分类法：如果领域层有一个目录对应它，schema 就有一个同名文件。

| 文件 | 表 | 枚举 |
|---|---|---|
| `iam.ts` | 5 | 4 |
| `sessions.ts` | 5 | 5 |
| `llm.ts` | 7 | 6 |
| `actions.ts` | 1 | 2 |
| `agents.ts` | 4 | 1 |
| `instructions.ts` | 2 | 0 |
| `backlog.ts` | 3 | 3 |
| `architecture.ts` | 2 | 0 |
| `git.ts` | 3 | 5 |
| `psychologist.ts` | 2 | 0 |
| `anamnese.ts` | 4 | 0 |
| `auth.ts` | 9 | 3 |
| `rag.ts` | 1 | 1 |
| `containers.ts` | 1 | 1 |
| `huggingface.ts` | 1 | 1 |
| `backup.ts` | 1 | 2 |
| **合计** | **51** | **34** |

有三处位置需要决定而不是查找，每一处都记录在接收它的文件顶部的注释中：

- **`handoffs` 放进 `sessions.ts`，而不是 `agents.ts`。** 实体是 `domain/sessions/handoff.entity.ts`：handoff 只存在于会话之中，领域层早已这样说。
- **`user_credentials` 放进 `llm.ts`，而不是 `iam.ts` 或 `git.ts`**，尽管 `credential_provider` 涵盖 LLM 密钥*和* git token。实体是 `domain/llm/user-credential.entity.ts`，而 `domain/git` 没有对应物——拆分跟随领域层，即使在领域层自己的选择是折中的地方也是如此。
- **`backup.ts` 是唯一没有对应 `domain/` 目录的文件。** 备份是运维基础设施，没有自己的业务规则。为了避免一个 60 行的文件而把它硬塞进 `architecture.ts` 或 `containers.ts`，会让映射在"什么是聚合"上撒谎。一个小而诚实的文件，比一条错误的边界代价更低。

### 2. 枚举放在调用它的表旁边，因为模块图必须保持无环 {#2-enums-moram-com-a-tabela-que-os-chama-porque-o-grafo-de-módulos-precisa-continuar-acíclico}

跨文件的外键在环中是安全的：`.references(() => otherTable.column)` 接收一个**惰性回调**，正是为了让前向引用得以解析。跨文件的**枚举**则不然：`storyPromotionModeEnum('story_promotion')` 在模块求值时运行，而一个边指向错误方向的环会在 import 时抛出 `ReferenceError: Cannot access '…' before initialization`，而不是在查询时。

因此有三个枚举放在其唯一调用方所在之处，而不是按主题分组会放的地方：

- `project_execution_mode` 和 `story_promotion` 放在 **`iam.ts`**，而不是 `git.ts`/`backlog.ts`。`projects` 是两者唯一的使用者。把它们放在"主题"文件中，会让 `iam.ts` 在求值时依赖 `git.ts` 和 `backlog.ts`，而这两者早已以惰性方式依赖 `iam.ts`——两个环，而 `iam` 是 barrel 第一个求值的模块，正是会失败的方向。
- `failure_origin` 放在 **`backlog.ts`**，由 `tasks.blocked_origin` 和 `delegations.failure_origin` 共享。`agents.ts` 早已从 `backlog.ts` 导入 `tasks`（用于 `delegations.task_id`），所以 `agents → backlog` 是已经存在的方向；反过来就会闭合成环。

由此得到的 import 图是一个 DAG：`iam.ts` 和 `backup.ts` 不从兄弟文件导入任何东西，其余一切都从它们流出。新增一张表时要保持的正是这个性质——而不是字母顺序。

### 3. `schema.ts` 变成 barrel；没有任何使用者改变 {#3-schemats-vira-um-barrel-nenhum-consumidor-muda}

`apps/api/src/db/schema.ts` 现在有 25 行 `export * from './schema/<file>'`，按原文件的阅读顺序（身份、会话、LLM、操作、agent，然后向外延伸）而不是字母顺序——顺序就是 schema 的目录。

**144 个从 `…/db/schema` 导入的模块**——`src/` 中 46 个，`test/` 和 `scripts/` 中 98 个——每一个都在零编辑的情况下继续工作，因为它们仍然从同一个说明符导入，而 barrel 再导出了一切。这包括 `infrastructure/persistence/drizzle/drizzle-client.ts`，其 `import * as schema` → `drizzle(pool, { schema })` 看到的导出集合与之前相同。

### 4. `drizzle.config.ts` 继续指向 barrel {#4-drizzleconfigts-continua-apontando-para-o-barrel}

`schema: './src/db/schema.ts'` 不变。`drizzle-kit` 用 esbuild 解析模块并沿着 `export *` 链走下去，所以它通过 barrel 发现全部 51 张表——已核实，而非假设：`pnpm --filter api db:generate` 打印出完整的表清单，然后是 **"No schema changes, nothing to
migrate"**。如果这失败了，glob（`'./src/db/schema/*.ts'`）是备选方案；它没有失败，而 barrel 是更好的指针，因为它也是应用代码使用的入口——一个决定"schema"含义的地方，而不是两个可能分歧的地方。

### 5. 验收标准是一个零 diff 的迁移，而不是测试套件通过 {#5-o-critério-de-aceite-é-uma-migration-de-diff-zero-não-uma-suíte-de-testes-passando}

这次改动是纯机械的：没有任何表、列、枚举值、索引名或约束表达式改变。证明是 `db:generate` 相对于 `src/db/migrations/meta/` 中的快照**不产生任何新的迁移文件，也没有任何 diff**——这比测试套件更严格，因为 Drizzle 比较的是*推断出的 SQL*，所以一个被反转的 `notNull`、一个被换掉的默认值或一个被重命名的索引，即使所有测试都通过也会在那里显现。

## 后果 {#consequências}

- **两个人可以同时修改 schema 而不冲突**，只要他们在不同的聚合中工作——这是常见情况，也恰恰是债务那一行说不可能的事。
- **对 schema 文件的 `git log` 现在可读了。** `git log --follow
  apps/api/src/db/schema/auth.ts` 能回答"认证的表发生了什么"，这个问题以前没有答案。代价：本次提交*之前*的历史仍在 `schema.ts` 中，而 `--follow` 不跨越拆分（它跟随重命名，不跟随一对多的拆分）。比本 ADR 更早的考古要走旧路径。
- **`docs/.docmap.yml` 的 `schema-e-migrations` 规则需要增加一个 glob。** 它监视的是字面路径 `apps/api/src/db/schema.ts`；拆分之后，`schema/llm.ts` 中的一个新 CHECK 约束甚至不会触及 barrel，规则会**静默地对它存在所要监视的东西失明**——约束，它自己的注释指出那通常就是业务规则。`apps/api/src/db/schema/**` 现在与 barrel 一起被监视，barrel 仍是一个真实文件，每当有表诞生或消亡时都会改变。
- **新增一张表现在需要两处编辑，而不是一处**：在其聚合的文件中加表，以及——仅当文件是新的时——在 barrel 中加一行。向已有文件新增一张表的代价与以前相同。
- **无环的 import 图现在是一个没有人保证的不变量。** 没有测试断言它；将来放错文件的枚举会在 import 时大声失败（启动时的 `ReferenceError`，而不是隐蔽的缺陷），但它会在某个人的终端里失败，而不是在审查中。已声明，未解决。
- **迁移没有被触及。** `src/db/migrations/` 及其快照逐字节相同；本 ADR 只关闭债务那一行中"单一文件"的那一半，别无其他。api↔engine 的 schema 契约债务是另一行，仍然开放，并继续开放。

## 被放弃的替代方案 {#alternativas-descartadas}

- **按层而不是按聚合拆分**（所有枚举一个文件，所有表另一个，所有索引再一个）：产出没有人有理由打开的文件，并让 `budgets_scope_check` 与 `budgets` 相隔两个文件。也解决不了冲突问题，因为每次改动仍会触及枚举文件。
- **一个共享的 `columns.ts`，再导出 drizzle 的列构造器**，让每个文件只导入一样东西。被拒绝：增加一个只为省打字而存在的模块，隐藏了文件实际使用了哪些原语，并让 import 列表不再是文件所做之事的摘要。
- **把 `schema.ts` 保留为真实文件，在旁边增加拆分**（逐步弃用）：同一批表有两个事实来源，`drizzle-kit` 会看到重复。直接被拒绝。
- **把 144 个使用者改为从特定聚合的文件导入。** 很诱人——它会让每个模块对 schema 的依赖变得明确——但它把一个零 diff 的机械改动变成了需要逐行审查的 144 个文件的改动，而这可以以后在任何人触及某个文件时逐个去做。barrel 不阻止这样做；它只是今天不要求。

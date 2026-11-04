---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0158 — 主密钥的 id 写入信封，作为可观测性，绝不作为权威

## 状态 {#status}

**已接受。** 对应维护者登记中的 `BRB-016`，它声明依赖 `BRB-010`——而这种依赖是字面意义上的：本决定改变了信封的格式，而证明当前格式能在一次完整轮换中存活的证据，诞生于同一次交付，在 [RN-562](../business-rules.md#rn-562) 中，**先于**这一行代码。不撤销 [ADR 0027](0027-fase5-backup-hardening-release.md)：信封方案、`CREDENTIALS_MASTER_KEY_PREVIOUS` 和 `rewrap-deks.ts` 保持原样。

## 背景 {#context}

`CREDENTIALS_MASTER_KEY` 包装着加密用户秘密的 DEK——`user_credentials` 中的 LLM 密钥和 `project_git_connections` 中的 git token。它的轮换是 runbook 中结局最糟的流程，runbook 本身也写明了原因（`docs/runbook.md`，"What's at stake"一节）：

> *"The `wrapped_dek` stored in the database **doesn't identify which key
> wrapped it**."*

2026-09-12 在 checkout 中测得：

| arquivo:linha | 那里有什么 |
|---|---|
| `apps/api/src/db/schema/llm.ts:255` | `wrappedDek: text('wrapped_dek').notNull()`——六个信封列，没有一个说明是哪个密钥 |
| `apps/api/src/db/schema/git.ts:72` | 同上，**相同**的六列 |
| `envelope-encryption.service.ts:128-138` | `decrypt` 先试当前密钥，再回退到之前的，在一个不区分原因的 `catch` 里 |
| `envelope-encryption.service.ts:148-160` | `rewrap` 也一样，而这个**不区分原因**的 `catch` 正是判断记录是否已在当前密钥上的依据 |
| `docs/runbook.md`，"Before: size it up" | 唯一可能的查询按表统计**总行数**——从不统计还剩多少 |

由此产生两个具体缺陷：

1. **轮换的第 2 步没有进度。** 在中途中断脚本的人不知道停在哪里；唯一的办法是再运行一次并读它打印的计数。而决定第 3 步的问题——*"还有凭据在旧密钥上吗？"*——在 SQL 中没有答案。
2. **错误的密钥和损坏的 blob 是同一个 `catch`。** 两者产生同样的通用失败，而它们是行动相反的诊断：一个要求重新发布之前的密钥，另一个要求调查该记录。

主宰这一领域的教训是 [RN-475](../business-rules.md#rn-475)：一个本应写入材料内部却没有写入的 id，让自动模式从未认证成功，并为一个一行的缺陷付出了一场追查。

## 决策 {#decision}

### 1. 信封开始携带 `key_id`，作为**列** {#1-o-envelope-passa-a-carregar-key_id-em-coluna}

`user_credentials` 和 `project_git_connections` 增加**可为空**的 `key_id text`，`EncryptedSecret` 增加 `keyId?: string | null`。两张表**一起**改变：它们共享同一个信封和同一个脚本，只改一张会产生一个查询只能回答一半的存量数据集。

用列而不是 blob 内部的前缀，因为主要使用者**是一条 SQL 查询**——runbook 的第 2 步。前缀会迫使读取并解码每一行来回答"还剩多少"，而那正是促成这一切的问题。

### 2. 值是派生密钥的**指纹**，仅此而已 {#2-o-valor-é-a-impressão-digital-da-chave-derivada-e-nada-mais}

```
key_id = HMAC-SHA256(chave_derivada, 'brabo-master-key-id')  → 16 primeiros hex
```

这回答了活动留下的开放 `TODO(humano)`——*"`key_id` 的值从哪里来？不能是密钥的哈希（会给读数据库的人一个离线验证的预言机），而 `.env` 中的手工计数器又是一个运维人员可能弄错的变量。"* 反对意见的两半都处理了，而第一半是**测量出来的，不是假设的**：

**没有新的预言机。** 读数据库的人早已拥有一个**完美**的离线验证预言机，就是信封本身：`wrapped_dek` + `dek_iv` + `dek_auth_tag` 是 AES-256-GCM，它会**认证**。今天测试一个候选口令就已经是 `scryptSync(candidata, SALT, 32)`，然后做一次 decipher，其 tag 要么验证通过要么不通过——每个候选都有确定的答案。有了 `key_id`，测试同一个候选是 `scryptSync(candidata, SALT, 32)` 加上一次 HMAC。**两种情况下每次尝试的成本相同，而且都由两者都必须付出的 `scrypt` 主导。** 能读数据库的攻击者什么都得不到；他能得到的东西他早已拥有。

**也没有新变量。** 运维人员不在任何地方输入 `key_id`：它是运维人员早已发布的那个密钥的纯函数。没有需要保持同步的第二个值，而那正是服务的 docblock 用来不写入任何 id 的论据（`envelope-encryption.service.ts:36-38`，*"记录中的密钥标识符是又一个需要保持同步的元数据"*）——对**任意**的 id 是对的，对指纹是错的。

写入的是 HMAC，不是密钥，也不是它的材料，共 8 字节。

### 3. `key_id` 是**可观测性**，绝不是**权威**——本决定正是在这里偏离了显而易见的做法 {#3-o-key_id-é-observabilidade-nunca-autoridade--e-é-aqui-que-esta-decisão-se-afasta-do-óbvio}

读取**不**开始按标签选择密钥。`decrypt` **逐字节**保持原样：先试当前的，回退到之前的，由 GCM 决定。`rewrap` 也保留尝试作为"已在当前密钥上"的判据。

显而易见的路径——用 `key_id` 跳过尝试——被考虑过并因为它自身的一种失败模式而**被拒绝**：一行标签写着"当前"、而信封却在旧密钥上，会被 `rewrap` 静默跳过，不计入重新包装的数量，而 runbook 的第 3 步会让它永远不可读。标签是一列中的额外数据；信封才是事实。**用一个标签取代加密的权威，会把一次元数据不一致变成秘密的丢失。**

因此标签服务于三件事，全都在加密决策路径之外：

- 第 2 步的**查询**（`WHERE key_id IS DISTINCT FROM '<atual>'`）；
- 当两个密钥都打不开时的**诊断**——消息开始点名是哪个密钥包装了那条记录，区分"来自另一个环境"、"没有 `key_id` 的记录，在本次改动之前写入"以及"标签说它在当前密钥上却仍然打不开"，后者就是上面的不一致，值得大声说出来；
- **来源**，由 `rewrap` 随新信封一起写入。

### 4. 不迁移存量数据 {#4-nada-de-migração-do-acervo}

`key_id` 在**下一次写入**时诞生：`encrypt` 写入它，`rewrap` 写入它。今天的行保持 `NULL`，而 `NULL` 恰恰意味着*"在本次改动之前写入，密钥未知"*——绝不是*"在当前密钥上"*。只为填充这一列而强制重新包装整个存量数据，会把一项可观测性改进变成作用于所有凭据的风险操作。

被接受并声明的后果：**在已有的安装中，第 2 步的查询只有在第一次轮换之后才生效。** 在那之前，一切都是 `NULL`，查询诚实的回答是"一个都不知道"，这与零不同——所以 runbook 的查询分别统计三个区段（当前 / 之前 / 无标签），而不是一个数字。

### 5. 运维人员需要知道**当前**指纹，所以由 api 说出来 {#5-o-operador-precisa-saber-a-impressão-digital-atual-então-a-api-a-diz}

一个没人能拿来比较的列是没用的。服务开始在启动时用**一**行记录当前密钥的指纹，而原有的轮换警告（`:75-78`）开始点名**两个**指纹。这正是 runbook 早已让运维人员去看的地方（*"Confirm the api is in
rotation mode — it warns in the log"*）。

输出到日志是安全的，理由与第 2 点相同：它是 8 字节的 HMAC，不会让针对数据库的任何尝试变便宜。

## 后果 {#consequences}

**开始成为可能的**

- 用 SQL 回答*"还有多少凭据在之前的密钥上？"*，这正是关闭 `BRB-016` 标准的东西。runbook 在第 2 和第 3 步中使用这条查询。
- 在 `rewrap-deks.ts` 的输出中区分来自另一个环境的记录与被篡改的记录——以前它们是同一行错误。
- 中断第 2 步后知道还剩什么再继续，而不依赖一次已经结束的执行所打印的计数。

**代价，已声明**

- 两张表上的一次迁移（`ALTER TABLE ... ADD COLUMN key_id text`）。可为空、没有默认值，所以它是新列中的新元数据：不重写行，不锁大表。
- 已有的存量数据在第一次轮换之前没有标签（第 4 点）。
- 还原了**另一个**环境 dump 的安装会得到一个新的、更好的症状：行的 `key_id` 与日志中的不一致，而[还原](../runbook.md#restore)不再需要 runbook 今天所描述的排除法诊断。

**不变的，也是要紧的那一半**

- 算法、DEK 的大小、`SALT` 和 `scrypt`。`encryptedApiKey` 的任何一个字节都不会因此被重写。
- `decrypt`。双密钥回退仍是机制，而决定的仍是加密。
- 脚本的名称和调用方式（`node scripts/rewrap-deks.js`），runbook 早已指向它。
- 轮换的步骤数：仍是**三**步。本决定让它变得**可观测**，绝不变短。

**排除在外的，具名列出**

- KMS、HSM 和按租户的密钥仍然是另一种设计，ADR 0027 保持原样。
- `key_id` 上的索引。两张表天生就小（每个用户/provider 一行，每个项目一行），而查询每隔很多个月才在一次轮换中运行一次：索引会让每天的写入付出代价，只为一年省两次顺序扫描。
- 诊断的 decrypt 那一半。读诊断的是运行脚本的运维人员，他就在那里；把同一条消息放进热读取路径会改变 `decrypt`，而本 ADR 决定不碰它。

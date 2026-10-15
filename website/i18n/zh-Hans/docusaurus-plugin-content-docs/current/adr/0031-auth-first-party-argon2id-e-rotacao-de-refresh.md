---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0031 — 自有认证：argon2id、EdDSA 与 refresh 轮换

## 背景 {#contexto}

自阶段 1 起，Brabo 通过 Keycloak 认证：compose 中多一个容器，Kubernetes 中多一个 StatefulSet，一个
需要维护的 JSON realm，以及每个请求路径上的一个网络依赖。作为交换，只用到了它所提供功能的一小部分——
密码登录、一个给 web 的公共客户端，以及两个用于内部流量的 service account。没有 MFA，没有联合认证，
没有社交登录。

这笔账算不平。Keycloak 在这个系统中真正解决的问题，放得进 api 领域中的一个模块；它所收取的却是永久的
运维。FASE 7a 把两边对调：认证放进领域，Keycloak 被移除。

本次交付（7.1）**并行地**构建这个模块，不碰 guard。全局的 `JwtAuthGuard` 继续校验 Keycloak 的
token，阶段 1 的 RBAC 不被触碰。原因是 guard 是 `APP_GUARD`，api 的其余部分都依赖它所填充的
`request.user`：在同一次交付中构建新认证并更换签发者，不会留下任何可测试的中间状态。新路由使用
`@Public()`，这个模块在当前系统继续运行的同时就可以端到端地被执行。

## 决策 {#decisão}

### 密码：argon2id，参数固定在代码中 {#senha-argon2id-com-parâmetros-fixos-no-código}

`m = 19456 KiB (19 MiB)`、`t = 2`、`p = 1`，输出 32 字节——OWASP 推荐的第二档配置。运行约 50 ms，
即使在并发校验下也能放进容器的内存限制。

参数放在**常量**中，而不是环境变量中。改变哈希成本不是调优：它需要一个对存量重新哈希的计划。暴露为
env，它就会变成有人在生产中为了“改善登录延迟”而调低的杠杆，而没人意识到保护已经降低。

库：`@node-rs/argon2`，相比 `argon2` 被选中，是因为它带有预编译的二进制——`Dockerfile.prod` 是基于
Alpine 的多阶段构建（ADR 0024），而另一个选择会要求 builder 中有编译工具链。

### Access token：EdDSA（Ed25519），15 分钟，派生的密钥 {#access-token-eddsa-ed25519-15-minutos-chave-derivada}

替代方案是使用 env 中机密的 HS256。选择 EdDSA，是因为公钥可以发布在 `/.well-known/jwks.json`，并由
任何服务在收不到用于**签名**的机密的情况下进行校验——使用 HMAC 时，校验者也能伪造。

密钥**不是生成的，而是派生的**：32 字节的 seed 来自
`scryptSync(AUTH_JWT_SECRET, 'brabo-auth-jwt-seed', 32)`，与 `EnvelopeEncryptionService` 已用于
凭据主密钥（阶段 1）的格式相同。这一次解决了三个问题——没有任何私钥被 commit；密钥对在副本之间、在
重启之间都相同（启动时的 `generateKeyPairSync` 会让每个进程一个密钥，症状是负载均衡器后面的间歇性
登录失败）；而轮换复制已有的模式，而不是发明第二种。

`kid` 是 JWK 自身的 RFC 7638 thumbprint：它来自密钥本身，因此不存在会与其所命名之物失步的变量。

通过 `AUTH_JWT_SECRET_PREVIOUS` 轮换，它**只在校验时**被接受并在 JWKS 中发布，从不用于签名——与
`CREDENTIALS_MASTER_KEY_PREVIOUS` 的设计相同，启动时带着同样喧闹的警告，提醒轮换需要完成。

### Refresh：256 位的不透明 token，HMAC-SHA256 哈希，强制轮换 {#refresh-token-opaco-de-256-bits-hash-hmac-sha256-rotação-obrigatória}

token 是 base64url 编码的 32 字节 `randomBytes`。数据库保存 `hmac-sha256(pepper, token)`。

**它不是 argon2，与密码相反的选择是有意的。** argon2 的存在是为了抬高针对低熵机密的字典攻击成本；面对
256 位的 CSPRNG 不存在字典，所以这份成本买不到任何一位。更糟的是：argon2 每条记录有自己的 salt，这会
让哈希不再只是 token 的函数——`where token_hash = $1` 将变得不可能，每次 refresh 都会变成全表扫描。
pepper（而不是纯 SHA-256）是免费的，它让一份没有进程环境的数据库 dump 毫无价值。

每次 refresh 都会消耗所出示的 token（`rotated_at`），并签发一个带**相同 `family_id`** 和**相同
`family_started_at`** 的子 token。出示一个已轮换过的 token 就是失窃的特征：吊销整个家族并写入安全
事件。

`family_started_at` 是会话的绝对上限。没有它，每 15 分钟轮换一次会产生永不结束的会话——而在某次审计
问起一个会话能活多久之前，没有人会察觉。

`rotated_at` 和 `revoked_at` 是**正交**的列。把两者合并会摧毁“你出示了一个已用过的 token”（失窃的
信号 → 级联）与“你出示了一个被别人的级联杀死的 token”（下游的受害者 → 不再告警）之间的区别。没有这个
区别，合法用户的每个标签页在事故期间都会产生一次失窃检测，恰恰在安全日志最需要可读的时候用噪声把它
塞满。

### 锁定：独立表中的滑动窗口，以邮箱为键 {#lockout-janela-deslizante-em-tabela-própria-chave-no-e-mail}

`auth_lockout_hits`，在结构上与 `rate_limit_hits`（ADR 0027）完全相同：用 CTE 在一条语句中完成
INSERT 和 COUNT，不用 Redis。

**与 `auth_events` 分开的表**，而不是在它上面加一列。按 CLAUDE.md 的规则，审计轨迹是 append-only
的，而在一次成功登录时清零计数需要 DELETE。放在一张表中就需要发明一个水位线（“自上次成功以来的失败”），
那会把限流的查询计划永远与审计的索引集合耦合在一起。分开之后，每张表各有适合它的规则——而保留期也
相反：计数器在一小时内就变成 PII 负债，审计轨迹则需要存续下去。

**桶的键是归一化后的邮箱（经 HMAC），而不是用户 id。** 用 id 的话，桶只有在找到账户之后才会存在：
针对不存在邮箱的尝试既不会被计数也不会被阻止，而锁定本身就会变成判断是否存在的预言机。用邮箱，真实
账户和虚构账户在构造上就表现一致。

阻止依据的是尝试**之前**的状态。依据之后的状态会让阈值少算一次：阈值为 5 时，第五次尝试即使密码正确
也会被拒绝。

邮箱桶和 IP 桶有**不同**的阶梯（5:30,8:300,12:900 和 20:30,30:120）。单一阈值会在两头都出错：每 IP
5 次会让 NAT 后的任何办公室瘫痪，每账户 20 次对密码攻击又太宽松。IP 的上限较短，因为在那里附带损害会
落在什么都没做的人身上。

邮箱阶梯的上限在构造上**等于窗口**。更高的上限需要一个持久化的 `locked_until`，外加解锁队列和管理
端点——滑动窗口无法表示比它自身更长的锁定。

### 邮箱枚举：一个不变量，而不是一份情形清单 {#enumeração-de-e-mail-uma-invariante-não-uma-lista-de-casos}

> Qualquer resposta diferente da falha uniforme só pode ser alcançada **depois**
> de uma verificação de senha bem-sucedida.

这条规则独自解决了所有情形，包括通常会漏掉的那些：不存在的邮箱、密码错误、被锁定的账户、被禁用的
账户，以及——最阴险的——从 Keycloak 导入、还没有密码的用户。对最后这种人回复“请设置你的密码”，会确认
该地址存在**并且**是旧账户，这是系统中最有价值的枚举信号。

具体的后果：查找凭据和 argon2 的 `verify` **总是**运行，即使没有账户（针对参数完全相同的 dummy 哈希），
即使桶已经被锁定。按邮箱的锁定检查放在 verify **之后**。提前退出是任何审查者的本能，而这恰恰就是泄漏——
便宜的分支约 1 ms 就响应，而昂贵的约 50 ms。

唯一的提前退出是 IP 桶的，理由恰好相反：那里没有隐藏任何东西（历史是请求者自己的），而运行 argon2
就等于交出这个桶存在要阻止的 CPU 耗尽。

注册对已登记的邮箱同样返回 `202`，付出同样的 argon2 成本，并通知该地址的所有者。一个 `409 Conflict`——
REST 的常识会要求的那种——会把用户名单交给任何拥有字典的人，并让登录处的所有谨慎变得毫无用处。

### 账户 token：一张表，通过条件 UPDATE 消费 {#tokens-de-conta-uma-tabela-consumo-por-update-condicional}

`account_tokens` 带一个用途枚举（`email_verification`、`password_reset`、`set_initial_password`），
而不是三张表：机制完全相同，变化的是数据。三张表意味着三份原子消费的 UPDATE，而那是这里唯一不能错两次
的东西。混淆用途的风险在入口处被关闭，每种用途一个方法——没有调用者会传入这个值。

消费是一条带 `returning` 的条件 UPDATE；这条 UPDATE **就是**守卫。先读后写会让两次同时提交都通过，
而这不是假设：企业邮件的安全扫描器会打开每封邮件中的每个链接，因此机器人常常在人点击之前就消费掉了
token。竞争是常态。

重置会吊销该用户的**所有**家族——与复用时的级联相反，区别在于威胁模型：那里证据指向一个家族；这里是
用户说“我觉得有人进了我的账户”。而且它不签发会话：直接通过邮件收到的链接登录，会让攻破邮箱等同于接管
账户，没有第二步。

## 后果 {#consequências}

**refresh 复用也会让合法用户登出。** 在服务器一侧，一次重复提交和一次窃贼重放逐字节相同——同一个
token、同一条路由，经常还是同一个 IP。没有信号可以区分，安全的策略是假定失窃。修正在客户端：
**single-flight** 的 refresh，所有调用者共享同一个进行中的 promise。这是 7.2 的要求，不是实现细节——
没有它，两个同时收到 401 的调用会让用户登出。

**web 无法说“这个邮箱已被使用”。** 表单改为说“如果该地址可用，我们已发送确认邮件”。这是产品成本，
为了关闭枚举而承担。

**被锁定的用户不知道自己被锁定。** 响应与密码错误完全相同，因为一个 429 或“账户已锁定”会告诉攻击者
账户存在、他命中了目标。缓解在客户端——连续 N 次 401 响应之后，登录界面建议等待——而这不来自服务器的
任何信号，因此不泄漏任何东西。

**access token 不可吊销。** 它是 15 分钟的无状态 JWT，因此存在一个最长 15 分钟的窗口，在密码重置之后
被盗的 token 仍然有效。这是不在每次请求时查询数据库的代价，也正因如此 TTL 才短。一个凭据版本的 claim
可以解决这个问题，它被记为 backlog——值得在 7.2 中重新评估，因为当前的 `JwtAuthGuard` 已经在每个请求
上访问一次数据库（`syncUser`），这让边际成本比通常小得多。

**不声称恒定时间。** 测试以确定性方式证明的是：没有任何分支跳过昂贵的工作，也没有任何分支产生可区分的
响应：`PasswordHasher` 上的一个 spy 校验登录的三个失败分支都恰好调用一次 `verify`，使用参数完全相同的
哈希。在共享 CI 上做计时测试是脆弱的，一个每二十次就红一次的测试比没有测试更糟——团队会学会按“re-run”。
剩余的差异（多一行日志、重置请求中已知分支的 INSERT）比网络抖动小几个数量级，在此记录为已接受。

**轮换 `AUTH_TOKEN_PEPPER` 会让所有人登出**，并使未完成的账户 token 失效。pepper 没有 `_PREVIOUS`：为了
一个几乎永远不会发生的场景，在每次 refresh 上永远接受双重校验，并不划算。这记录在 runbook 中。

**公开表面从四条路由跃升到十二条。** 每一条都在 [`docs/security-surface.md`](../security-surface.md)
中有理由说明，而 `route-surface.spec.ts` 逐字列出这十二条——再开一条仍然需要修改测试。值得记录这暴露了
什么：`RateLimitGuard` 会放行 `@Public()` 路由，因此认证路由**没有一条**受它覆盖。守住这个表面的是渐进
锁定，且只有它。

### 有意识的 backlog {#backlog-consciente}

出于决定而非遗忘排除在范围之外：

- **MFA**（TOTP、WebAuthn）、**社交登录**和 **OIDC 联合认证**。Keycloak 提供过它们而它们没有被使用；
  现在重新实现，就是在没有需求的情况下付出成本。
- **api 作为 OIDC 提供方。** 它认证自己的用户，不是给第三方的签发者。
- **泄露密码字典**（HIBP、rockyou）。领域中的短列表能捉住显而易见的，也不伪装成更多。
- 在 argon2 参数改变时的**机会式重新哈希**。
- 在宽限窗口内**容忍 refresh 重放**，以缓和重复提交。它有真实的安全成本——在窗口内重放的窃贼能拿到
  一对有效的 token 而不触发告警——因此只有在客户端的 single-flight 之后、如果仍有必要才会引入。
- **清理认证相关的表**（`auth_lockout_hits`、`refresh_tokens`、`account_tokens`）。限流已经有清理；
  这些需要进入同一个机制。

### FASE 7a 还缺什么 {#o-que-ainda-falta-na-fase-7a}

本 ADR 覆盖 7.1。仍然开放的有：在 `JwtAuthGuard` 中更换签发者（7.2）、把 OpenAPI 收集到
`docs/reference/api/`（7.3）、engine 与 api 之间的 service token、导入 Keycloak 的用户，以及从
compose、manifest 和 web 中移除 Keycloak。ADR 0027 对 HTTP 表面做了分类，ADR 0024 和 0025 设计了镜像
和部署——当 Keycloak 退场时，这三者都需要被引用，而不是被编辑。

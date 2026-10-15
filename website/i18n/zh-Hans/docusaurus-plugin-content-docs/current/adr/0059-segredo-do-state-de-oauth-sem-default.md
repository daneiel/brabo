---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0059 — 签署 git OAuth `state` 的密钥没有默认值

- **状态：** 已接受
- **日期：** 2026-08-08
- **先前背景：** [ADR 0024](0024-fase5-imagens-producao-ci.md)（生产 compose 的密钥）、[ADR 0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)（缺陷正是在驳回一条关于这把密钥的告警时出现的）

## 背景 {#contexto}

在关闭 ADR 0058 的安全告警时，其中一条（`js/insufficient-password-hash`，关于 `oauth-state.ts`）被驳回，理由是那里没有密码：“password” 是 `GIT_OAUTH_STATE_SECRET`，一把服务器的 HMAC 密钥，而 HMAC-SHA256 是签署 OAuth `state` 的正确原语。

这个理由是对的，并且仍然成立。它没有考虑到的是，一把**带有已知默认值**的服务器密钥**什么也签不了**——而情况正是如此。两个读取点都在做：

```ts
process.env.GIT_OAUTH_STATE_SECRET ?? 'dev-oauth-state-secret-change-me'
```

这与 `WEB_ORIGIN` 已经在 `cors-origins.ts` 中关闭的故障模式相同：开发默认值在生产中同样生效。在这里它出于两个原因更糟。

**第一，这个值是公开的。** 它在一个开源仓库的 `.env.example` 中。这不是攻击者需要猜的弱默认值；它是一个已公布的密钥。

**第二，是这把密钥保护的东西。** `state` 是防止 OAuth 回调被伪造的东西（见 `docs/security-surface.md`）。密钥已知时，任何人都能为任选的 `{projectId, userId, provider}` 签出有效的 `state`，而回调会——在该 payload 指向的项目中——写入从 provider 获得的 git token。这是连接流程中的 CSRF，奖品是 git 凭据。

而这种事情发生的路径并不是假设的。`docker-compose.prod.yml` 把字面量作为回退值提供：

```yaml
GIT_OAUTH_STATE_SECRET: ${GIT_OAUTH_STATE_SECRET:-dev-oauth-state-secret-change-me}
```

忘记这个变量的人会在毫无迹象的情况下用示例中的密钥签名启动生产。这个细节决定了修复的形式，也是本 ADR 最重要的一点：**只要求变量“不为空”什么也抓不到**，因为在真实的出错路径上它是定义了的——只是值是错的。

## 决策 {#decisão}

密钥的解析从用例中移出，成为 `apps/api/src/infrastructure/security/oauth-state-secret.ts` 中的单一函数，紧挨着解决了等价问题的 `cors-origins.ts`。在生产中（`NODE_ENV === 'production'`），它在三种情况下**让启动失败**：

1. 变量缺失或只有空白；
2. 变量等于仓库中的示例字面量；
3. 变量少于 16 个字符。

在生产之外，默认值继续有效，因为没有 `.env` 的 `docker compose up` 必须能工作。

检查在**启动**时运行，在 `main.ts` 中，而不是在第一次使用时。一个只在有人尝试连接 git 时才失败的 api，可能会运行好几周，接受用公开密钥签名的 `state`——错误需要在启动时出现，那里它响亮且可逆。

### 为什么用一个函数，而不是在每个调用方检查 {#por-que-uma-função-e-não-a-checagem-em-cada-chamador}

与促成 `projectScopeRoot()` 存在的理由相同（[RN-092](../business-rules/custo.md#rn-092)）：同一个字面量有两份副本，在不同的文件中（`start-git-oauth.use-case.ts` 和 `handle-git-oauth-callback.use-case.ts`）。重复的检查总有一天会分歧——而在这里分歧的话，回调会拒绝所有合法的 `state`。有一个测试专门覆盖两端用同一把密钥签名和验证。

### 为什么设长度下限 {#por-que-um-piso-de-tamanho}

`docs/reference/configuration.md` 的表格对这个变量一直写着“fraco = CSRF no fluxo de conexão de git”。下限把这句话变成了验证。它有意设得很低：拒绝 `senha123`，而对任何认真方式生成的密钥不发表意见——`openssl rand -base64 32` 给出 44 个字符。

### 代码之外改变了什么 {#o-que-mudou-fora-do-código}

- `docker-compose.prod.yml` 不再提供该字面量。这一行仍然在那里，值为空，因为省略它会隐藏这个变量的存在。
- `docker/smoke.sh` 生成自己的密钥，并随栈一起丢弃。脚本中的固定值会是又一个公开字面量——正是这项检查要防止的东西。
- README 开始在启动生产 compose 的命令旁边展示密钥的生成。

## 后果 {#consequências}

**有意的破坏：** 今天在没有 `GIT_OAUTH_STATE_SECRET`（或使用示例值）的情况下启动的生产**将无法启动**，并给出说明要生成什么的消息。这是目标，而不是副作用：这样的生产本来就有漏洞，而以前无从得知。这适用于 README 中记录的 `docker compose -f
docker/docker-compose.prod.yml`。

在 Kubernetes 中没有任何变化：`deploy/k8s/base/common/externalsecrets.yaml` 本来就从保管库获取这个变量。

**仍然未决，而且比本 ADR 更大：** 同样的模式适用于 `AUTH_JWT_SECRET`、`BRABO_SERVICE_TOKEN`、`CREDENTIALS_MASTER_KEY` 和 `SECRET_KEY_BASE`，它们在生产 compose 中都有开发默认值。这里一个都没有动——本次变更的范围是 OAuth 的密钥，顺带处理其他的会掩盖它们是四个独立的决定，各有各的破坏半径。已记录在 [docs/explanation/backlog.md](../explanation/backlog.md) 中。

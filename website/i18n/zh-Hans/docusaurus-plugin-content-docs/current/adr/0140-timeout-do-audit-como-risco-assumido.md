---
traducao_de: 13603dddc11848b2458bb703718cbc1709f9c47d
---

# 0140 — `pnpm audit` 反复超时是承担的风险；发现问题仍然失败

## 背景 {#context}

2026-09-04，npm 的 advisories 端点（`POST registry.npmjs.org/-/npm/v1/security/advisories/bulk`）连续数小时时断时续。`Auditoria de dependências` 作业在**四个不同的 PR**（#464、#466、#396、#468）中失败，签名总是一样：

```
[WARN] POST .../security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.
[WARN] POST .../security/advisories/bulk error (503). Will retry in 1 minute. 1 retries left.
TimeoutError: The operation was aborted due to timeout
```

不是依赖树，不是 runner，也不是任何一个 PR。它**在 CI 之外被重现**，从另一台机器直接请求该端点：20 秒内同样没有响应，而同一 registry 上的普通 `GET` 在 130ms 内响应。`pnpm audit` 内部已经重试三次（上面两行 `retry`）；服务就是不响应。

代价不只是时间。还有这种情况教会人的行为：每一次这样的失败都靠重跑作业直到通过来解决，而**学会重跑直到通过的人，在红色是真的时也会重跑**。一个无故报警的 gate 不会保持中立——它会侵蚀人们对有理由报警的 gate 的信任。

## 决策 {#decision}

**产品所有者的决定：registry 三次尝试都没有响应，是承担的风险。** 作业保持绿色，并在摘要中给出醒目的警告。

这个决定**没有**放松的，也正是让它站得住的：

| 情况 | 裁决 | 重试 |
|---|---|---|
| `pnpm audit` 以 0 退出 | 通过 | — |
| 漏洞报告 | **失败** | 无——答案已经来了，而且是否定的 |
| 请求未完成（timeout/5xx/DNS/socket） | 基础设施 | 最多 3 次 |
| 连续 3 次基础设施问题 | 通过，**已声明** | — |
| 无法识别的输出 | **失败** | 无 |

**优先级是这件事的核心。** `scripts/ci/auditoria-de-dependencias.ts` 对输出进行分类，**发现问题**的标记在网络标记**之前**检查：一个碰巧提到 `timeout` 的报告——一个叫这个名字的包、一个关于 timeout 的 CVE——不能被当作不可用而放过。正好有一个测试针对这种情况。

**未知的失败会失败（fail closed）。** 如果输出与两种签名都不匹配，裁决就是 `achado`。唯一比失败太多的 gate 更糟的，是放行了自己没弄懂的东西的 gate。

**警告说明这次执行**不**断言什么。** 当风险被承担时，作业摘要记录依赖树*没有被审计*——绝不说它是干净的。因不可用而绿和因审计干净而绿是不同的状态，作业在文字上不把它们混淆。

**逻辑放在可测试的脚本中**，而不是 YAML 里的 `bash`：分类是一个有 11 个用例的纯函数，包括运行 33838507158（引发这一切的那次）的**真实**输出，而不是转述。

## 后果 {#consequences}

**存在一个真实的风险窗口，并且已声明。** 在 npm 长时间不可用期间，PR 会在没有依赖审计的情况下进入。这记录在 [cadeia-de-suprimentos-do-ci.md](../explanation/cadeia-de-suprimentos-do-ci.md) 的 “What is still trusted on faith” 一节，与其他承担的信任放在一起——而不是藏在某个工作流的注释里。

**替代方案在被拒绝之前测量过。** 因第三方宕机而保持红色，当天的代价是四个 PR 被卡住、多次每次约 5 分钟的重跑，而其中没有一次发现了关于代码的任何东西。这种僵硬买到的是严格的外表；付出的是忽视红色的习惯。

**只有 pnpm 这一侧改变。** `mix hex.audit` 和 `mix deps.audit`（Elixir）保持原样——事故出在 npm 的端点上，把例外扩展到没有要求它的地方，会把一次性的决定变成普遍政策。

**仍然没有答案的：** 风险频繁被承担时没有告警。单个 PR 中的三次超时是第三方噪声；一周内每个 PR 都有三次超时，实际上就是 gate 被关掉了，而今天除了有人注意到之外，没有任何东西区分这两种情况。这作为声明的缺口保留，不在此解决。

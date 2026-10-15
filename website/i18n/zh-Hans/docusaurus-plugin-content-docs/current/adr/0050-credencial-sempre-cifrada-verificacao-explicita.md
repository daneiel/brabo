---
traducao_de: 23e727d97992c1974a3df731360a293b67fd669c
---

# 0050 — 凭据总是被加密；验证成为显式动作

## 背景 {#contexto}

[ADR 0004](0004-git-credential-registration.md) 为 git 令牌确立了：登记**在加密并持久化之前先针对 provider 测试凭据**——无效令牌会返回错误，而不是被保存下来以后再失败。第 11a 阶段把同样的顺序复制到了 LLM 密钥上。

这个顺序看起来很谨慎。在真实使用中，它产生了最糟糕的结果。

一位 owner 试图在设置界面登记 OpenRouter 的密钥。六次点击，六次 `POST /users/me/credentials`，六次 `422`。在他那一侧，保存按钮**什么也没做**——而这部分是 web 中的第二个缺陷（`handleSave` 没有 `try/catch`，`ApiError` 逃逸到只做日志的 `window.onunhandledrejection`）。但即使消息显示在屏幕上，设计本身也已经错了，原因有三，而它们只有放在一起才会显现：

1. **什么都没被写入，而密钥无法找回。** 该字段是只写的，界面从不重新显示输入的内容。一次拒绝让用户既没有凭据**也**没有可以修正的文本——他重新打开界面，回到与之前相同的状态，丢掉了他粘贴的东西。
2. **登记是在信息不完整的情况下做判断。** 测试会因为密钥无效、密钥没有余额、网络、超时、DNS 而失败。它们都在错误的时刻变成同一个 `422`：保存的时刻。“这把密钥好吗？”与“我想保存这把密钥吗？”不是同一个问题，把它们绑在一起会让第二个依赖第一个此刻就有答案。
3. **界面的承诺变得不可能兑现。** “只写，永不重新显示”意味着没有人——连所有者也不行——能核对保存的内容。如果保存可能静默失败，就没有任何方式知道凭据处于什么状态。

还有一个没有理由的不对称：`POST /users/me/git-credentials` 与 `POST /users/me/credentials` 分开存在的唯一书面理由，恰恰就是这个强制测试。

## 决策 {#decisão}

**保存和验证是两件事。登记只负责保存；验证是针对已保存凭据的独立动作。**

适用于两类——LLM 密钥和 git 令牌。它们是同一张表（`user_credentials`）、同一套信封加密机制，以及对用户的同一个承诺；区别对待会为同一个对象产生两个规则不同的界面。

1. **`UpsertUserCredentialUseCase` 和 `RegisterGitCredentialUseCase` 去掉了 tester。** 剩下两行：加密和写入。一把 provider 会拒绝的密钥同样会被写入——登记不做判断。

2. **`TestStoredCredentialUseCase`**（新增，
   `application/use-cases/credentials/`）通过 `findSecretByUserAndProvider` 读取信封、解密、调用正确的 tester（git 或 LLM，由 `isGitCredentialProvider` 分派），并**只返回裁定**。明文只存在于方法内部，不穿越任何边界。

3. **结果有**三**种状态，而不是两种：**

   | | 何时 | 原因 |
   |---|---|---|
   | `ok` | provider 接受了 | — |
   | `recusado` | provider 拒绝了 | 携带**它的原因**（`401`、超时、没有余额）——有用的诊断 |
   | `nao_suportado` | 没有经过验证的测试端点 | `ollama`、`anthropic`、`openai` |

   第三种状态不是装饰。对于没有经过验证端点的 provider，LLM 的 tester 是 NO-OP，在二值结果中它们会返回 `ok`：界面会声称密钥已被检查，而没有人检查过。这与 [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) 的 capability 规则相同——只声明被证明过的东西。这就是 port 增加 `supports()` 的原因：没有它，`test()` 的沉默是有歧义的。

4. **`POST /users/me/credentials/:provider/test`**——三种结果都返回 200，因为请求已被处理；`recusado` 是一种结果，不是协议错误。没有凭据时返回 404：那时没有可测试的东西。

5. **坏密钥不再是 HTTP 异常。** `LLMCredentialConnectionTestFailedError`
   和 `GitCredentialConnectionTestFailedError` 继续存在并由 tester 抛出，但现在由用例捕获。它们从两个 `@Catch`（`LlmBindingErrorFilter`、`GitProviderErrorFilter`）中移除：一个不可能触发的过滤器就是死规则，与 docmap 对不匹配任何文件的 glob 所用的标准相同。

6. **一个长度上限，它是保护——不是格式验证。**
   两个 DTO 中都有 `CREDENCIAL_COMPRIMENTO_MAXIMO = 512`，与密码的 `@MaxLength`（`domain/auth/password-policy.ts`）性质相同：路由会加密，而加密会复制输入。这个值刻意宽松。在一把被截断的密钥被静默写入之后，诱惑是把上限收紧到让它“验证”密钥——而那会从另一扇门重新造出关口。九个 provider 的真实凭据从约 26 个字符（`glpat-`）到约 164 个字符（OpenAI 的 project key）不等；一个接近真实长度的上限会拒绝登记好的密钥，并在某个 provider 加长格式时变得过时。一把只有一半的密钥仍会被接受，而揭穿它的是测试路由。

7. **界面提供能提供的东西。** 无法核对保存的内容，因此提供的是**替换**（字段现在在已保存凭据时也可见——以前必须先删除）和**测试**。每条路径都增加了带 toast 的 `try/catch`：正是它们的缺失把一个有解释的 422 变成了一个哑巴界面。

## 后果 {#consequências}

**变好的。** 登记之后凭据总是存在，因此总有东西可以修正、替换或测试。诊断比以前更好：以前 `422` 只说“没成功”；现在 `recusado` 带着 provider 的原话。git 路由不再有单独存在的特殊理由——它保持分开只是因为正文格式，这一点写在 controller 中。

**变差的，并被接受。** 一把无效的密钥可能一直被保存，直到有人测试它或第一次真实使用失败。这是刻意的：自 ADR 0041 起，第一次使用的错误按 `code` 规范化，而备选方案——拒绝写入——正是本 ADR 要撤销的。每个 provider 的 smoke 继续针对真实 API 证明真实密钥，现在经由新路径。

**不变的。** 信封加密、`user_credentials`、不含秘密的投影、路由的 RBAC，以及明文永不出现在任何响应中的规则。

## 留待以后的 {#o-que-fica-para-depois}

- **在使用时测试，并显示出来。** 今天 `chat`/`sync` 中的拒绝表现为轮次错误；它本可以在界面上把凭据标记为可疑。这需要按凭据持久化的状态——不属于本 ADR。
- **没有经过验证测试端点的 `openai`/`anthropic`** 仍为 `nao_suportado`。关闭方式是阅读各自的官方文档，把 base URL 加入 tester 的映射，并用 smoke 证明。

引用 [ADR 0004](0004-git-credential-registration.md)，本 ADR 颠倒了它的顺序；以及 [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)，从它继承了只声明被证明之物的规则。两者都不被编辑。

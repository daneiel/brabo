---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0046 — 由用户拥有权限的故事晋升

## 背景 {#contexto}

dogfooding 的发现 #13，逐字引自
`docs/missions/dogfooding-mission.md:669`：

> Não existe "promover a ready": a promoção é automática na criação.
> `TransitionStoryUseCase` valida e emite `backlog.story_transitioned`, mas
> **não está ligado a rota nenhuma** — é código morto. A aba Backlog é
> somente leitura.

它诞生时被归为 **P2**，后来成为第 12 阶段要消灭的三个 P1 之一，原因只有在那次运行之后才变得清楚：三个发现中，这是唯一与便利无关的一个。采纳和重新调度是摩擦——人手工做了机器本该做的事。这里恰恰相反：机器独自做了人本该决定的事，而 `CLAUDE.md` 在说明产品是什么的第一行就说，最终权限属于用户。一个故事在创建时就变成 `ready`，意味着 PO——一个 LLM agent——独自决定什么进入 dev agent 的工作队列。

在设计**之前**于代码中验证的三个事实塑造了这一决定：

1. **`story.status` 是 claim 的关口。** `TaskRepository.claimNext` 按 `s.status = 'ready' AND s.module_ids ? module AND t.status = 'todo' AND
   t.blocked = false` 过滤。除了故事的状态之外，没有任何东西区分“被提出的工作”和“可领取的工作”。
2. **验证是重复且不对称的。** 创建调用 `canBecomeReady`；转换调用 `assertReady` + `assertModulesResolved`。同一状态有两扇门，锁却不同。
3. **`TransitionStoryUseCase` 已经做了一切**——验证、发出事件，并且自第 12b 阶段起为每个被释放的 task 写一行 outbox `task.became_claimable`。缺的是一个调用者。

## 决策 {#decisão}

**`proposed_ready` 是一个布尔值，而不是状态枚举中的新值。**
这是第一个被放弃的尝试。`story_status = 'proposed'` 会更有表达力，但枚举字面上就是 claim 的关口（事实 1）：增加一个值就必须重新审视每个比较状态的查询，而漏掉一处不会报错——只会让一个故事悄无声息地过早可被领取。布尔值说出了事物的本质：对一个仍是 `draft` 的故事的**提议**。状态机的状态不变，因为实际上什么都没变；存在的是一项指向用户的待办。

**晋升复用 `TransitionStoryUseCase`；没有编写新的转换。**
发现 #13 中的死代码重新被调用，并免费带来 12b 的重新调度：晋升会写入唤醒该模块空闲 dev agent 的 outbox 行。一个“专属”的晋升将不得不重新实现这一点——而忘记它的第一个版本会让这批 task 可被领取却没有人被通知，agent 只会在下一个不相关的事件中偶然发现。

`execute` 增加了一个可选的 `actor` 参数。事件 `backlog.story_transitioned` 是不可变的，是审计所读取的东西；在一次由用户决定的晋升中写入 `agent/po`，会恰恰抹掉本阶段要归还的人的那一步。

**验证在让触发器可配置**之前**被统一到 `assertPromotable` 中**，这个顺序不是细节。只要两条路径的锁不同，“通过 UI 晋升”和“在创建时晋升”就是同名的两条不同规则，`manual` 模式会因实现上的偶然而比 `auto` 更严或更松。`story-promotion.spec.ts` 中的对称性测试维持着这一属性：**模式改变的是**谁**触发，从不改变**验证什么**。**

一个几乎让 `auto` 模式静默坏掉的细节：空的 `moduleIds` **通过**验证，而且必须通过。创建时故事还没有模块——分配它们的是 Arquiteto，之后。在不保留这一点的情况下把 `assertPromotable` 接到创建路径上，会让 `auto` 模式再也不晋升任何东西，而且没有任何错误。

**回填是定向的，而不是盲目的。** 该列以 `manual`（新默认值）诞生，同一个迁移把所有现有项目移到 `auto`。这与 RN-046 的回填相反，后者可以是盲目的，因为在它之前不存在采纳。这里的行为早已存在并在使用中：一个进行中的项目不能因为一次部署而停止产出。新默认值适用于之后来的人。

**拒绝镜像 gate 对 dev 的退回，并颠倒 rearm 的顺序。**
原因成为固定在 PO 会话中的消息——对话型 agent 中 system prompt 之外的第一个 `pinned`——带有自 ADR 0020 起 dev agent 的 `correction_message/1` 所携带的同一句优先级说明。之所以固定，是因为拒绝是待办，而不是对话：被 `ContextManager` 压缩后，PO 会带着同样的缺陷重新提出同一个故事。

写入发生在调用 engine **之前**，与 `RearmDevAgentUseCase` 相反。在那里，事件（`dev.rearmed`）断言的是**关于 engine** 的事，提前写入会在 engine 拒绝时让日志撒谎。这里事件断言的是关于**用户**的事——他拒绝了，无论是否有 PO 在线倾听，这都是真的。因为 agent 进程在重启中死掉而丢失决定，会毫无理由地让用户回到起点。因此 engine 是尽力而为的，内部路由在 PO 已死时返回 **404**，而不是抛出 `:noproc`。

**退回消息说的是 PO**能**做什么，这是一个被接受的限制。** 不存在编辑故事的工具——只有 `create_story`。消息让它创建修正后的版本，或在原因不清楚时询问用户。说“修正这个故事”就是在要求不可能的事，而面对不可能指令的模型会发明工具或重复调用直到耗尽循环——dev agent 正是这样在 ADR 0020 的验收中连续烧掉了三次修正。

**批量晋升不是全有或全无。** 每个故事是自己的事务；失败的那个以 `failed` 带原因返回，在一个 201 中。真实情况是具体的：在 PO 的提议与用户的决定之间，一个模块可能已经离开了 `module_map`。为此中止整批，会撤销用户刚刚对其他故事所做的审阅。

## 后果 {#consequências}

默认值改变了，这对创建新项目的人来说是**行为破坏**：在有人晋升之前，backlog 不会自行推进。它作为不兼容项写在 CHANGELOG 中。现有项目毫无感觉。

Backlog 界面不再是只读的。这是仅有的两项属于用户而不是 agent 的 backlog 写入——其余一切继续经由 `/internal/*` 路由进入。

`POST /internal/sessions/:id/agent/revise` 是第一条把工作退回给**对话型** agent 的 api→engine 路径。到目前为止，退回（gate → dev）都是 engine 内部、进程内的。这条路由从 `rearm` 继承了格式以及调用前的存在性检查。

留待以后，作为 backlog 而不是隐藏的债务：

- **编辑故事的工具。** 在它存在之前，拒绝循环通过重建来闭合，被拒绝的故事带着记录下的原因留在 `draft`。这是可审计的，但会在 backlog 中留下垃圾。
- **带并排审阅的批量晋升。** 今天批量是多选，故事在队列中展开；当数量增长时，一个专门的审阅界面才有意义。
- **降级一个被误晋升的故事。** `assertTransition` 允许 `ready → draft`（这正是 RN-012 的 `story_demoted` 的运作方式），但用户没有这样做的路由。今天的路径是在晋升**之前**拒绝。

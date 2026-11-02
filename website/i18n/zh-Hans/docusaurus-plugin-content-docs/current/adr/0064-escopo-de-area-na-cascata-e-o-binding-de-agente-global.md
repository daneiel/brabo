---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0064 — 模型级联中的领域范围，以及全局的 agent 绑定

- **状态：** 已接受
- **日期：** 2026-08-09
- **先前背景：** [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md)（两层能力，以及降级时 `resolveBinding` 的重新验证）、[ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)（领域作为按项目的数据，`agent_areas`/`agent_area_members`）、FASE 18（领域随项目诞生，RN-094）

## 背景 {#contexto}

用户的请求：“para leads de áreas e seu subgrupo estarem em conjunto,
dando a possibilidade de escolher um mesmo modelo vigente para ambos.”他的决定也一并给出了——领域的模型是**可继承的默认值**：某个特定 agent 可以偏离，UI 显示谁在继承、谁偏离了。

绑定级联（`domain/llm/binding-resolver.ts`）今天解析 `sessão > agente > projeto > workspace`，每个范围一个绑定，最具体的胜出。`agent_areas`/`agent_area_members`（ADR 0053，FASE 18）已经是按项目的真实数据——lead、子 agent 和并行上限。缺的是领域的**模型**进入同一个级联。

这引出一个位置问题：领域进入哪两个层级之间？还有第二个问题，只有在试图回答第一个时才出现，它是本 ADR 的核心。

### 不一致：agent 绑定是**全局**的，领域是**按项目**的 {#a-incoerência-binding-de-agente-é-global-área-é-por-projeto}

`SetModelBindingUseCase.execute('agent', agentSlug, ...)` 以 `scope_id = agentSlug` 写入——一个 SLUG，没有项目。`PUT
/projects/:projectId/agent-bindings/:agentSlug` 在路由中接收 `:projectId` 并**明确丢弃**它：代码中的注释已经说明这是有意的。在一个项目的界面上选择 Arquiteto 的模型，会在它存在的**所有**项目中改变它的模型。

相反，领域自 ADR 0053 起就是按项目的——两个不同项目中的同一个 `qa` 可以有不同的上限和（现在）不同的模型。

在同一个级联中把一个**按项目**的范围放在一个**全局**范围之上，是事实上的矛盾，而不仅是风格上的：同一个 agent 会**只在配置了领域的地方**按项目解析出不同的模型，而在所有其他地方相同——这种行为取决于数据的偶然，而不是规则。有两个出路，互相排斥：

1. **agent 绑定改为按项目。** 改变一个自 Fase 9a 起就存在的行为。
2. **领域在级联中位于 agent 之**下**。** 保持 agent 全局，但与“可继承的默认值”相矛盾——领域永远无法成为一个已经有绑定的 agent 的默认值（这是常见情况，因为**今天**几乎所有登记的绑定都是 agent 的，它与项目之间没有别的层级）。

## 决策 {#decisão}

**选择了选项 1：agent 绑定改为按项目。**

级联获得 `area` 层级，位于 `agent` 和 `project` 之间：

```
sessão > agente > área > projeto > workspace
```

领域是一个领域的 lead 和子 agent 共享的**默认值**；agent 自己的绑定是覆盖它的显式**偏离**。这个**顺序**——而不仅仅是层级的存在——才是用户决定的落实：如果领域位于 agent 之上，它将永远胜出，“可继承的默认值”在实践中就成了“强加的默认值”。

为了让这个位置在没有“全局范围在按项目范围之上”这一矛盾的情况下成立，`agent` 绑定必须不再是全局的。`agent` 和 `area` 的 `scope_id` 变成了**复合**的：`<projectId>:<slug do agente | chave da área>`。没有新表：项目的 `UUID` 和 slug/键从不包含 `:`，这使第一个 `:` 成为无歧义的分隔符（`domain/llm/binding-scope-id.ts`），旧格式（没有 `:`）在写入时被**拒绝**——写入它会创建一个级联再也找不到的绑定，看不见而不是一个错误。

迁移 0040 把每个现有的全局 agent 绑定展开为每个项目一行，保留每个项目在变更之前解析出的模型，并删除旧格式。是展开而不是选择一个“所有者”项目：全局的那一行从未保存过它属于谁的信息。

**新层级进入已经存在的同一个能力重新验证**（ADR 0041/RN-041/RN-043）：从 provider 消失或不支持工具调用的领域模型会被跳过并记录在 `skipped` 中，与 `agent` 已经发生的完全一样。`area` 也开始要求 `supports_tool_calling`（`assertModelFitsBindingScope`）——它从不被人类聊天读取，只被 agent 读取，放过它会把同样的静默失败推迟一个层级。

**“重新继承”会删除绑定，绝不把下层的模型复制到上层。** `DELETE /projects/:id/agent-bindings/:slug` 和 `DELETE /projects/:id/area-bindings/:key`，两者都是 204，当范围已经在继承时两者都是 404。把领域决定的模型写进 agent，在界面上看起来一样却并不一样：它会变成副本，领域的下一次变更会静默地把这个 agent 落在后面——继承就是**没有**自己的决定。

更改**领域**的模型需要 `maintainer` 角色，而不是单个 agent 那样的 `developer`——与并行上限（RN-083）的理由相同：领域的绑定一次就触及 lead 和所有子 agent，而选择模型就是决定产品不经询问花多少钱。agent 绑定仍是 `developer`，与之前一样。

UI（`ProjectSettingsTab.tsx` 中的 `AreaModelsSection`）在 agent 表旁边列出每个领域的默认值；当 `origin === 'agent'` 时，agent 表的来源列获得“voltar a herdar”——agent 偏离了，在它有领域时偏离领域，没有时偏离项目/workspace。

## 后果 {#consequências}

- **级联从四层增长到五层**，每个枚举这四层的使用者（测试、DTO、UI 中的 `ORIGIN_TONE`）都需要第五层。这是一次性付出的代价；结构（能力的重新验证、`skipped`、显式的来源）已经存在，只是被扩展了。
- **agent 绑定不再是全局的。** 依赖全局 slug 的——三个种子/演示脚本——改为按项目写入（`chaveDeAgente(projectId, slug)`）。不再有“这个 agent 在所有地方用一个模型”的方式；今天想要这个的人按项目配置，或者在 `workspace` 中配置（它仍然是全局的，是所有人的回退）。
- **领域没有自己的绑定表**——它以 `scope = 'area'` 复用 `model_bindings`，理由与 `agent` 一直复用它相同：绑定没有任何属性取决于范围的类型，只取决于 `scope_id`。
- **复合的 `scope_id` 是隐式的格式**，没有数据库约束强制（它是 `text`）。验证只存在于一个函数中（`assertScopeIdBemFormado`），阻止幽灵绑定的是它——而不是 schema。如果有一天 `area`/`agent` 获得自己的表，这个格式会变成它的 `id`，`scope_id` 就会消失。
- **按领域默认值的继承够不到目录之外的子 agent**：agent 的领域由静态目录（`agent-areas.ts`）解析，它已经通过谓词 `ehDevDeModulo` 覆盖了 `dev` 的动态领域，无需往返数据库——不需要对 `agent_areas` 的任何新查询。

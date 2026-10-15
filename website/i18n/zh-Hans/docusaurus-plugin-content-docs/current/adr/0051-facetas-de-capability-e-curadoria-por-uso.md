---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0051 — 已证明的能力维度；“用来做什么”是策展

## 背景 {#contexto}

OpenRouter 的第一次真实同步给策展界面带来了 **338 个模型**。按厂商分组（Fase 12，带子组的 hub）让列表可以浏览，却没有回答面对它时真正提出的问题：*这些中哪个适合我现在的需要？*

针对线上 API 测得的两个发现，界定了这个问题。

**第一：目录已经公布了界面没有显示的东西。** 解析器读取 `id`、`name`、`context_length`、`pricing` 和 `supported_parameters`——却丢弃了 `architecture`。更糟的是，同步在模态能力上从不查询远端：

```ts
// sync-model-catalog.use-case.ts:202, antes
supportsVision: local?.supportsVision ?? false,
```

值来自已经保存的内容，而已经保存的内容诞生时就是 `false`。结果：338 个全是 `supports_vision = false`，包括那些 provider 整个页面都叫“vision”的模型。这一列生而为假、死而为假——不存在任何它能变成真的路径。

对照 2026-08-04 的目录，OpenRouter 声明：**181** 个模型接受图像输入，**11** 个产出图像，**213** 个接受 `reasoning`，**25** 个接受音频，**0** 个产出视频。

**第二：想要过滤的东西有一半在任何目录中都不存在。** 请求中包括“melhores IAs por tipo — documentar, imagem, vídeo, thinking,
code”。图像和 thinking 是 provider 声明的。“最适合代码”和“适合文档”**没有任何 provider 公布**——没有字段，没有约定，除了模型名称什么都没有。而从名称推导能力，正是 [ADR 0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) 所禁止的：能力只在测试套件证明时才声明。

视频是极端情况：九个 provider 中零个模型。视频维度会是一个永远匹配不到任何东西的过滤器。

## 决策 {#decisão}

**两条轴都存在，彼此分开，各自住在它的事实所在的地方。**

### 1. 能力维度——provider **证明**的东西 {#1-faceta-de-capability--o-que-o-provider-prova}

`models` 中的三个新字段，由远端目录提供：

| 字段 | 在 OpenRouter 中的来源 |
|---|---|
| `supports_vision` | `architecture.input_modalities` 包含 `image` |
| `generates_image` | `architecture.output_modalities` 包含 `image` |
| `supports_reasoning` | `supported_parameters` 包含 `reasoning` |

图像的输入和输出是**不同的轴**，而不是一条：读图表的模型和画图的模型解决的是不同的问题，把它们合并会把用户送到错误的模型那里。

同步开始从远端读取，以本地为回退，与 `supportsToolCalling` 的形式相同：

```ts
supportsVision: remoto.supportsVision ?? local?.supportsVision ?? false,
```

远端的 `undefined` 保留本地值——**没有声明不等于声明没有**。当 provider 沉默时，解析器省略这个字段，而不是发出 `false`；在那里声明 `false`，会在 provider 第一次改变目录格式时抹掉手工做的策展。

音频和视频被排除在**外**：音频是因为今天产品的任何部分都不使用它，视频是因为它不存在。有可过滤的东西时它们再进入。

### 2. 按用途的策展——**团队**发现的东西 {#2-curadoria-por-uso--o-que-o-time-descobriu}

五种用途的封闭词汇——`codigo`、`documentacao`、`analise`、`imagem`、`conversa`——按 workspace 标记，在 `workspace_models.uses` 列（`text[]`）中。

它住在 `workspace_models` 而不是 `models` 中，理由与 [ADR 0049](0049-curadoria-de-modelo-por-workspace.md) 相同：它是**运营者的意见**。同一个模型在一个 workspace 中是“写代码的那个”，在另一个中是便宜的聊天模型，而付账的人才有权决定。没有全局轴，因为不存在全局的答案。

**封闭**词汇，而不是自由文本：一周之内界面上出现 `code`、`coding`、`Code` 和 `código`，就会产生一个什么都匹配不到的过滤器——比没有过滤器更糟。新用途进入类型并获得迁移，两侧都有编译期的穷尽性证明（与 `llm-provider-names.ts` 相同的机制）。

用 `text[]` 而不是 Postgres 的枚举，就像 Fase 8 的 `delegations.area`：新用途不应需要类型迁移。

### 3. 两条轴在 UI 和数据库中都不混合 {#3-os-dois-eixos-não-se-misturam-na-ui-nem-no-banco}

- 能力徽章和用途徽章在目录行上有**不同的色调**，过滤 chip 由分隔线隔开。
- 标记用途**不会**在选择器中打开模型。`is_active` 列的 DEFAULT 是 `true`，所以由用途标记产生的行以显式的 `isActive: false` 插入——没有这一点，对一个模型发表意见就会授权它花钱，违反 [RN-043](../business-rules/custo.md#rn-043)。
- 更改用途不会关闭已打开的东西：`is_active` 不在 `ON CONFLICT` 的 `SET` 中。
- 界面从不写“não lê imagem”。徽章只断言属实的东西，因为这里的 `false` 意味着“provider 没有声明”。

## 后果 {#consequências}

- 界面通过两条路径回答“哪个模型适合这个”：provider 证明的，以及团队在使用中发现的。
- 一个把列表清零的过滤器，开始与空目录可以区分——以前界面会对已经有凭据的人说“cadastre uma credencial”。
- 现有目录只有在**下一次同步**时才获得真实的维度：迁移以 `false` 创建这些列，是同步从远端填充它们。不查询 provider 就不可能回填，而编造值就又是原来的缺陷。
- 不公布模态的八个 provider 继续是 `false`——诚实的，并且一旦其中任何一个开始声明就可以降级处理。
- “最适合代码”在这个产品中永远不会是能力。如果有一天某个 provider 公布了这样的字段，那也只是又一个意见——它的意见——不能替代团队的意见。

三种设计被舍弃，每一种的原因就是它会留下的后果：

- **从模型名称推断用途**（`*-coder-*` → 代码）：穿着数据外衣的猜测。它在擅长代码的通才上出错，在名字里有“coder”而团队觉得不好的模型上出错，而知道的人没办法纠正。
- **`models` 中的全局用途**：会恰好重复 ADR 0049 纠正的缺陷——一个 workspace 替邻居做决定。
- **用途中的自由文本**：一周之内就会把词汇碎片化，把过滤器变成文本搜索。

## 留待以后的事项 {#o-que-fica-para-depois}

**音频和视频的维度**，当有可过滤的东西时：音频在 OpenRouter 中已经有 25 个模型，但今天产品的任何部分都不使用音频；视频在九个 provider 中为零。

**按标记的用途排序目录**——今天用途只用于过滤。词汇锁定后，排序只是一行；在没人标记过任何东西时，它会按空列表排序。

**其他八个 provider 的维度。** 今天只有 OpenRouter 公布模态；其余每一个都需要对照官方文档进行调查，就像 Fase 11 对各种怪癖所做的那样——禁止把一个的解析器继承到另一个上。

规则见 [RN-056](../business-rules/custo.md#rn-056) 和 [RN-057](../business-rules/custo.md#rn-057)。

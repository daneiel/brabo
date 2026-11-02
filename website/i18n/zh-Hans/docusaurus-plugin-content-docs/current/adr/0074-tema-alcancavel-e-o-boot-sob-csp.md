---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0074 — 可切换的主题，以及 CSP 下的启动

**状态：** 已接受 · 2026-08-14

## 背景 {#contexto}

`design/tokens.css` 从第一天起就有两套主题。深色是主主题，位于 `:root`；浅色位于 `[data-theme='light']`，由一致性测试度量（每个语义颜色 token 都必须在其中重新声明），并在 `design/README.md` 中被当作产品的一个界面来引用。

它从来都不是。**`apps/web` 中没有任何地方写入 `data-theme`**——`index.html` 没有，`main.tsx` 没有，任何组件也没有。选择器存在，值存在，而看到浅色主题的唯一办法是在 DevTools 里手动输入该属性。测试 `apps/web/test/design-contraste.test.ts` 知道这一点，并且说得清清楚楚：*"`[data-theme='light']` existe nos tokens e **nada o define** em nenhum lugar da app"*——它还更进一步，通过 `expect` 断言浅色主题下**有三组配对不通过** AA，而且是有意为之，"como registro do que se herda, não como garantia do que se renderiza"。

另一边，`apps/web/src/lib/contraste.test.ts` 只在深色主题下度量语法配色，注释也说明了原因：`--accent`、`--warning` 和 `--success` 在浅色 `--code-bg` 上已经低于 4.5:1。只要浅色主题无法到达，这两个文件就都是对的——度量一个没人能打开的界面，就是在度量一个意图。

改变这笔账的是第 28 号计划要求的主题按钮。按钮一旦启用，产品可见界面的一半就会变成从未被度量过的界面，而登记在案的三项不通过也就不再是有记录的债务，而是被交付出去的缺陷。

还有一个交付细节，并非无关紧要。handoff（`design_handoff_brabo/tokens.css`）的指示是：*"aplique o atributo o mais cedo possível (script inline no `<head>`)"*。web 的生产镜像在 `script-src 'self'`（`docker/web/nginx.conf`）下提供服务，没有 `'unsafe-inline'`，也没有 nonce。head 中的内联 `<script>` 在 `pnpm dev:web` 下能工作，但**在发布的镜像中会被拦截**——这是 ADR 0036 的失败以另一个主体重演：那一次 handoff 要求 Google Fonts 的 `<link>`，CSP 拦截了它，而症状（整套字体回退到系统字体）只在生产环境出现。

## 决策 {#decisão}

**1. 主题变得可切换，而启动脚本是一个文件。**

`apps/web/public/theme-boot.js` 读取 `localStorage['brabo.theme']`，只接受 `'dark'` 或 `'light'`，并把 `data-theme` 写到 `<html>` 上。默认 `dark`。它以 `<script src="/theme-boot.js"></script>` 的形式进入 `index.html`，同步执行并位于 bundle 之前，旁边是出于同样原因早已存在的 `/config.js`。

用文件而不用内联，是因为 CSP 是 `script-src 'self'`。同步且在 bundle 之前，是因为 `data-theme` 决定了整个 `tokens.css` 的颜色：如果在 hydration 之后才应用，浅色主题的用户每次加载都会看到一次深色闪烁。它是不带 `import` 的纯 ES5——vite 的 `public/` 按原样复制，不经过构建——并且有一个测试读取该文件，一旦它不再是纯 ES5 就判定失败。

`apps/web/src/lib/tema.ts` 是"产品"那一半：`temaAtual`、`aplicarTema`、`alternarTema`、`observarTema`，外加导出的键名和默认值。按钮不在那里——它属于 shell。两个文件重复了键名和默认值，因为启动文件不能导入任何东西；`tema.test.ts` 中的一个测试读取启动文件，两者一旦不一致就判定失败：这是产品唯一会出现写一个键、读另一个键的方式。

这条路径上没有任何东西会抛出异常。`localStorage` 可能抛出（隐私模式、iframe 中被屏蔽的 storage），而主题是偏好，不是功能：在那里失败不能拖垮启动。未知的值——手写的键、旧版本的残留——会回退到默认值，而不是变成 CSS 不认识的 `data-theme`。

**2. 浅色主题开始被度量，并且值被修正到通过为止。**

现在配对在两套主题下都会被度量，覆盖度量对比度的三个文件。浅色主题有六个 token 改变了值。数字来自对已解析 token 计算的 `razaoDeContraste`，而浅色主题中要求最高的背景是 `--code-bg`（纸色，`#efe4d2`，与各层表面只差一级）——对它达标，就对其余所有背景达标：

| token（浅色主题） | 之前 | 之后 | 迫使修改的配对 | 之前 → 之后 |
|---|---|---|---|---|
| `--accent` | `#c4552d` | `#a5451f` (`--terracota-500`) | `--code-bg` 上的 keyword | 3,56 → **4,81** |
| `--accent-hover` | `#a5451f` | `#7e3316` (`--terracota-600`) | 跟随 accent，低一级 | 4,81 → **7,04** |
| `--warning` | `#b5701c` | `#8a5410` | `--code-bg` 上的 string | 3,15 → **4,98** |
| `--success` | `#217e73` | `#136a60` | `--code-bg` 上的类型 | 3,89 → **5,12** |
| `--violet` | `#7b56c9` | `#6b4fb0`（handoff 的值） | `--code-bg` 上的数字 | 4,16 → **4,95** |
| `--text-muted` | `#80939a` | `#526670` | `--surface-0` 上的元数据 | 2,76 → **5,17** |

有两个副作用值得记录。第一：在深色主题下属于**已知债务**的五组配对，修改之后在浅色主题下都超过了 4.5:1——`--text-muted`/`--surface-1` 3,02 → 5,68，`--text-muted`/`--surface-2` 2,40 → 4,50，`--accent`/`--surface-1` 4,23 → 5,72，`--danger`/`--surface-1` 已经是 5,59，`--success`/`--surface-2` 3,66 → 4,83。浅色主题不再有债务，这一点由测试断言，以免在无人察觉时倒退。第二：那条"设计系统的已知例外"——主按钮上 `--on-accent` 对 `--accent` 为 3,20:1——在浅色主题中消失了，因为测试注释描述的修复办法（"escurecer o accent até `--terracota-500`, 5,27:1"）正是浅色主题现在所做的。在深色主题中例外依然存在：在那里改动 accent 就是改动品牌色，而没有任何东西迫使这样做。

浅色的 `--text-muted` 值得单独一提。它在 `--surface-2` 上为 2,40:1，那不是债务，而是**缺陷**：它连界面元素的下限（3:1）都没达到，而那是现存最低的下限。元数据和 label 都是文本，浅色主题没有理由比主主题更差——新值在 `--surface-0` 上为 5,17，高于深色主题早已提供的 4,81。

**3. 八种语法角色获得各自的 token，handoff 的值只有在度量通过时才采用。**

高亮配色原本是三个 token（`--syntax-function`、`--syntax-comment`、`--syntax-operator`）加五处对语义 token 的复用。现在变成 handoff 的八种角色，使用仓库已在用的 `--syntax-*` 前缀，并且每套主题有自己的值。为这八种命名，才能让高亮在需要的那天与语义 token 分道扬镳——而这恰恰是 handoff 所做的。

**handoff 的八个值中有五个因度量而被拒绝**，这是本 ADR 最重要的一项。对照 handoff 自己的 `--code-bg`：`--syn-cm` 在深色下为 4,09:1，浅色下为 2,32:1；`--syn-kw` 在浅色下为 4,34:1；`--syn-str` 4,20:1；`--syn-fn` 4,14:1；`--syn-op` 4,00:1。全都低于代码文本所要求的 4.5:1。handoff 不通过的地方，以度量出的值为准——与 ADR 0036 同一把尺子：handoff 的意图有效，不通过的数字无效。八个值在两套主题下对 `--code-bg` 都达到 4.5:1，而仍在实际着色的五个语义 token（本次改动没有碰 `SyntaxTokens.module.css`）也一并被度量——只要它们还是那个像素，下限就向它们收取。

**4. 缺失的名字以别名形式加入，绝不重命名。**

`--font-display` 和 `--shadow-modal` 是 handoff 中对应 `--font-heading` 和 `--shadow-lg` 的名字。它们以指向后者的方式加入。重命名将是在几十个文件里按同义词盲目替换，`--r-*` 家族也作同样处理：`--r-xs`（5px）和 `--r-sm`（7px）是新的，`--r-md`/`--r-lg`/`--r-pill` 是已有 `--radius-*` 的别名，而 `--radius-*` 保留。注意有一级并不一致：`--r-sm` 是 7px，`--radius-sm` 是 4px——它们不是同义词，这里也没有迁移任何调用点。

一起加入的还有 `--fs-*` 字号阶梯（八级）和 shell 的尺寸（`--sidebar-w`、`--sidebar-w-collapsed`、`--header-h`、`--tabs-h`），它们原本散落在每个绘制侧边栏和标签栏的 CSS 模块里。

## 后果 {#consequências}

**主题闪烁不再可能发生，代价是多一次请求。** `theme-boot.js` 是同源提供、可缓存、几百字节的文件。在 HTTP/2 下它与早已存在的 `/config.js` 一起传输。这是 CSP 中不带 `'unsafe-inline'` 的代价，也是 ADR 0058 总体上决定支付的代价。

**深色主题没有改动任何一个值。** `:root` 中没有 token 被修改——已知债务的五组配对仍是 3,89 / 3,10 / 3,88 / 3,88 / 4,41，被与之前相同的数字锁定。今天使用产品的人看不出任何差别；打开按钮的人会看到一个通过 AA 的主题。

**浅色主题比 handoff 所设计的更暗。** 浅色主题的强调色比 handoff 指定的十六进制值低一级，拿界面与 `.dc.html` 对比的人会注意到。这种差异是有意的，形式与字体那次相同：handoff 确立意图（色系、角色、级别），度量确立数字。一个让代码界面中的 `const` 无法阅读的漂亮浅色强调色不是忠实，而是忠实于一个从未打开过 Code 标签页的原型。

**五个新的 `--syntax-*` token 还没有使用者。** `SyntaxTokens.module.css` 仍把 keyword/string/数字/类型/文本指向语义 token。这是一个选择：改动连线就是改动 Code 标签页和聊天 Markdown 的高亮，那属于其他工作线，而测试今天覆盖两套 token。连线改变的那天，值已经度量好了——并且在浅色主题中，每种语法角色今天与为它着色的语义 token 拥有**相同**的数字，这是有意的：同一个像素有两个不同数字的来源，会在第一次只改一边时分道扬镳。

**三种 agent 颜色仍是游离的十六进制值。** `apps/web/src/lib/agents.ts` 中的 `#B9A5E8`（Psicólogo 浅色）、`#5EBEB1`（Dev Frontend）和 `#8AA6AE`（SecOps）在 `tokens.css` 中没有语义对应。`--violet` 的重复值（`#9C7BE0`，出现在两个 agent 中）已换成 token；剩下的三个保留，并在文件内声明，因为顺手在设计系统中新增三种颜色是产品决策，而不是路径上的修正。后果是已知的：这三种颜色不随主题变化——它们是针对深色背景挑选的，在浅色主题中比其他颜色更显得发白。

**偏好按浏览器保存，而不是按账户。** 它存放在 `localStorage`，因此不会跟随用户到另一台机器，也不会出现在设置中。跟随操作系统（`prefers-color-scheme`）同样没有纳入：`lerTemaSalvo()` 返回 `null`——而不是默认值——正是为了让以后决定这件事的人能知道此人从未选择过。今天 `null` 回退到 `dark`。

**有一条测试断言被反转了，这类改动值得一读。** `apps/web/test/design-contraste.test.ts` 曾通过 `expect` 断言浅色主题的三组配对**不通过**。那不是一个松散的测试：它是用 CI 唯一能读懂的语言写下的债务。主题可切换之后，这条断言反了过来——同样的认证配对在两套主题下按同样的下限收取。阅读这个文件历史的人会看到一个 `toHaveLength(3)` 变成一组 `toBeGreaterThanOrEqual`，原因就在这里。

## 参考 {#referências}

- [0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) — 自托管字体：同样的失败（handoff 要求 CSP 拦截的资源），同样的结局（意图是，机制否）。
- [0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md) — 使内联脚本不可行的 CSP 策略。
- [RN-182](../business-rules/autenticacao.md#rn-182), [RN-183](../business-rules/autenticacao.md#rn-183),
  [RN-184](../business-rules/autenticacao.md#rn-184), [RN-185](../business-rules/autenticacao.md#rn-185).

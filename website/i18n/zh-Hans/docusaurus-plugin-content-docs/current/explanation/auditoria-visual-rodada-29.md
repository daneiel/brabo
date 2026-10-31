---
traducao_de: 929963d24eb727bd64875486f2f1889172f3084a
id: auditoria-visual-rodada-29
title: 视觉审计：Rodada 29 之前与之后
description: AT-290 的界面审计——主要路由在两种主题下以 1440 px 和 390 px 截图，在每个界面上运行布局检查器，以及 Rodada 29 修复了什么、什么仍然存在、什么是新的，于 2026-09-30 针对 dev 的 79e6b1209f 测量。
---

# 视觉审计：Rodada 29 之前与之后 {#visual-audit-before-and-after-rodada-29}

> AT-290（EP-031，HS-074）。这是一次**测量，而不是变更**：为了写这一页，`apps/`
> 中没有任何改动。“之前”的截图于 2026-09-30 针对 `dev` 的 `de18e6a6e2` 进行；
> “之后”的截图于同一天针对 `dev` 的 `79e6b1209f` 进行，后者已包含整个 Rodada 29——
> 带柔和赤陶色强调的中性黑色主题（AT-283/284）、`Card`/`Chip`/`Badge`/`Button`
> （AT-286..288）、移动端外框（AT-316）、会话栏（AT-317）、对话流截断
> （AT-319）、审批的修复（AT-296..299、AT-310、AT-318、AT-320）、设置的预算
> （AT-321）、PR 和 Containers 的文案（AT-323、AT-324）以及 i18n 的一轮处理
> （AT-289、AT-326）。
>
> 截图**不**在仓库中。每条发现都写明截图的文件名，以便拥有截图文件夹的人打开它；
> 每条由检查器测得的发现也写明数字。

## 产品是如何启动的（以及这不覆盖什么） {#how-the-product-was-brought-up-and-what-that-does-not-cover}

任务要求通过 `docker/smoke.sh` 并设 `SMOKE_KEEP_UP=1` 启动生产 compose。这在一个
一次性 compose 项目中尝试过（`COMPOSE_PROJECT_NAME=r30visual`），并且**在此环境中
失败**，原因与“之前”记录的相同：出站代理阻止了
`dl-cdn.alpinelinux.org`（以及 `repo.hex.pm`/`builds.hex.pm`），因此
`docker/engine/Dockerfile.prod` 的第一个 `apk add --no-cache build-base git` 以 2
退出，没有构建出任何生产镜像。一次性项目已用 `down -v` 删除。

因此“之后”运行在**与“之前”相同的替代环境上**，这是有意为之——不同的栈会让比较测量
的是栈本身：

- **Postgres**：容器中的 `pgvector/pgvector:pg16`，api 的 migration 以及
  `pnpm seed`（seed 在新数据库上干净地运行）。
- **api**：从此 checkout 构建的 `node dist/main`，端口 3000。
- **engine**：端口 4000 上对一切都返回 200 的 HTTP stub。没有 Phoenix 通道，没有
  `engine.*` schema。
- **web**：端口 5173 上 `vite` 的开发服务器。
- **数据**：seed 加上与“之前”相同的脚本化填充——一个带对话、brief、业务规则、
  Criativo→PO handoff、epic/故事/任务和一个 `module_map` 的创意会话；第二个带真实
  对话流和一个 `agent.error` 的创意会话；以及**分布在 3 个会话中的 4 个待处理
  `proposed_actions`**（3 个 `terminal`，1 个 `git_push`），格式与之前相同。

对阅读本页的影响：

- 会话的 socket 总是失败，因此回合的活动条和代码页的终端从不出现，会话以回退间隔
  轮询。
- `GET /workspaces/:id/projects-summary` 返回 500，因为 `engine.dev_agent_states`
  不存在——这是 stub 的产物，和“之前”一样。Dashboard 上的 “0 agentes” 不是发现。
- 数据与“之前”**并不完全相同**：seed 现在会激活自己的会话，Criativo→PO 的提议在
  PO 的 backlog 事件到来时（AT-291/292）已被取代，而最新的会话是咨询式的。当“之前”
  的某条发现依赖于已不存在的数据时，它被标为**未复核**而不是“已修复”。
- 截图是 `fullPage`，但大多数界面在内部容器中滚动，所以它们显示的是视口。定向裁剪
  （`detalhe-*`）覆盖了整页截图够不到的部分。

截图是**有节奏的**——界面之间 6 s，主题/视口轮次之间 65 s——并记录到零个 429 响应。
“之前”没有控制节奏，所以它的设置页截图部分是在速率限制下拍的；速率限制在下文单独
测量（G1）。

## 文件 {#files}

存放在仓库之外，位于会话的 scratchpad（`shots-depois/`）：

- `<screen>--<dark|light>--<desktop|mobile>.png`：19 个界面（登录、dashboard、
  项目的 12 个标签页、两个会话、`/containers`、`/account`、`/status`）× 2 种
  主题 × 2 种视口（1440×900 和 390×844）= 76 张截图。
- `detalhe-*`：1280 和 1024 下的会话、对话流顶部、折叠的侧边会话面板、会话的结尾、
  “Precisa de você”、两种主题下的移动端抽屉、设置的 11 个分区，以及在速率限制下
  到达的最后一个分区。
- `validacao-visual.json`：注入每张截图的 `scripts/dev/validacao-visual.js` 的输出，
  加上实际应用的主题（`data-theme`）、页面的水平滚动宽度、加载期间对 api 的请求以及
  429。
- `console-erros.json`、`sondas-dark.json`、`g1.json`、`g1-cliques.json`：下文引用的
  控制台错误和 DOM 探针。

截图脚本（`capturar-depois.mjs`、`detalhes-depois.mjs`、`g1.mjs`、
`g1-cliques.mjs`、`gaveta.mjs`）就是“之前”的脚本，增加了节奏控制和探针。

## 检查器，逐个界面 {#the-checker-screen-by-screen}

`validacao-visual.js` 统计四类布局缺陷
（`texto-cortado`、`fora-da-viewport`、`recortado-por-ancestral`、低于 24 px 的
`alvo-pequeno`）。每个界面在两种主题下、之前和之后的数字都相同，因此每种视口一列就
够了。“之前”的移动端数字**不能直接比较**：在 AT-316 之前，大部分内容被推到了屏幕
之外，而检查器看不到的东西它不会统计。

| 界面 | 桌面 之前 → 之后 | 移动 之前 → 之后 | 每次加载的 api 请求（之后） |
|---|---|---|---|
| login | 6 → 6 | 8 → 8 | — |
| dashboard | 0 → 0 | 1 → 0 | 6 |
| overview | 3 → 1 | 12 → 2 | 32 |
| executors | 0 → 0 | 4 → 0 | 22 |
| creative | 0 → 0 | 7 → 3 | 20 |
| chat | 0 → 0 | 5 → 1 | 16 |
| insights | 0 → 0 | 4 → 0 | 17 |
| code | 0 → 0 | 2 → 0 | 16 |
| PRs | 0 → 0 | 5 → 1 | 18 |
| approvals | 1 → 1 | 13 → 1 | 23 |
| backlog | 0 → 0 | 5 → 2 | 16 |
| architecture | 0 → 0 | 11 → 0 | 15 |
| spend | 0 → 0 | 9 → 0 | 18 |
| settings | 12 → 6 | 120 → 35 | 52 |
| session | 5 → 2 | 14 → 21 | 21 |
| session 2 | 4 → 1 | 21 → 19 | 21 |
| containers | 1 → 1 | 9 → 8 | 7 |
| account | 0 → 0 | 6 → 2 | 7 |
| status | 1 → 1 | 1 → 1 | 2 |

在 390 px 下，只有一个界面会让整个页面横向滚动：`/status`
（`scrollWidth` 413 对 390，两种主题下皆然）。

## “之前”的发现，逐条 {#the-before-findings-one-by-one}

严重程度与“之前”相同：**A** 高（破坏使用或造成误导）、**M** 中、**B** 低（打磨）。
状态：**已修复**、**部分修复**、**仍存在**或**未复核**（显示它的数据已不存在）。

### 外框与导航 {#shell-and-navigation}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| S1 | A | 部分修复 | 外框在 390 px 下重新排布：侧边栏变成抽屉，项目轨道变成横向条，除 `/status` 外没有任何已认证界面横向滚动。**会话**路由没有跟上——见 N1。 | `*--mobile.png`、`detalhe-gaveta-mobile--*.png` |
| S2 | M | 仍存在 | 侧边栏 “ATIVIDADES — Nenhum agente entrou em ação ainda.”，旁边的概览却显示 Criativo “aguardando” 以及 4 个待处理审批。 | `projeto-overview--dark--desktop.png` |
| S3 | M | 仍存在 | 侧边栏的标签页列表没有计数器，也不标记当前标签页；轨道显示 “Aprovações 4” 和 “Arquitetura 1”，并高亮该标签页。 | 同上 |
| S4 | M | 已修复 | 只有一种激活态处理：轨道中赤陶色底配赤陶色文字；侧边栏中的项目行是中性的。 | 同上 |
| S5 | B | 仍存在 | 主题切换器仍然读出状态（“Tema escuro”/“Tema claro”）；“sair” 仍是小写。 | 任意已认证界面 |
| S6 | B | 仍存在 | 项目名称在侧边栏中用等宽字体，在页头中用展示字体。 | 同上 |

### 登录、Dashboard {#login-dashboard}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| L1 | B | 仍存在 | 同样 4 个低于 24 px 的目标。 | `validacao-visual.json`、`login--*` |
| L2 | B | 仍存在 | 同样被自身框截断的文字。 | 同上 |
| D1 | M | 仍存在 | 在没有预算的项目中，“0 / 0 USD” 和 “0%” 显示为绿色。 | `dashboard--dark--desktop.png` |
| D2 | M | 仍存在 | 在有 4 个会话和数十个事件的项目中显示 “Sem atividade ainda”（部分是 stub 的 500，见顶部）。 | 同上 |
| D3 | B | 仍存在 | “+ Novo projeto” 带图标；“+ Nova ideação” 和 “+ Nova conversa” 带一个字面的 “+”。 | dashboard × creative × chat |

### 概览 {#overview}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| O1 | M | 未复核 | 动态只显示最新的会话（咨询式），其中没有 PO/Arquiteto 的事件。 | `projeto-overview--*` |
| O2 | M | 仍存在 | 现在更长了：“dev-web: ação aguardando decisão — A política decidiu por: default (sem regra aplicável) · raiz do escopo: pasta gerenciada “core-api-665191a6””。 | 同上 |
| O3 | B | 未复核 | 在这些数据下团队时间线是空的。 | 同上 |
| O4 | B | 部分修复 | 按来源分的页脚消失了（“1 de 1 carregados”），但标题写着 “1 eventos”——见 N9。 | 同上 |

### Criativo、Chat、洞察、执行者 {#creative-chat-insights-executors}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| C1 | M | 仍存在 | Criativo 和 Chat 中是等宽字体的胶囊，PR 中是矩形的无衬线标签页。 | `projeto-criativo--*`、`projeto-chat--*`、`projeto-prs--*` |
| C2 | B | 部分修复 | “1 história” 现在会变形；“3 ação(ões) proposta(s) … 0 decidida(s) … auto-aprovada(s)” 和 “0 chamada(s)” 仍然存在（`sessions.json:164,172,173`、`spend.json:20,37`）。 | creative、chat、spend |
| C3 | B | 未复核 | seed 的会话现在是 `active`，所以双重 “aguardando” 不出现。 | creative |
| C4 | B | 仍存在 | 四种空状态形式（洞察中是纯文本，代码中是锁形卡片，Chat 中没有，Backlog 的可追溯性中是一张红色卡片）。 | 标签页 |
| C5 | B | 仍存在 | 洞察和架构的标题从 y≈145 开始，其他标签页从 y≈116 开始；故事只有上标题。 | `projeto-insights--*`、`projeto-arquitetura--*`、`projeto-backlog--*` |
| C6 | B | 仍存在 | “Conversar/Buscar” 位于标题 “Chat” 之上。 | `projeto-chat--*` |

### 代码与 PR {#code-and-prs}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| P1 | M | 已修复 | PR 写着 “A lista de PRs ainda não está liberada” 并解释共享的闸门；代码写着 “A aba Código ainda não está liberada”。 | `projeto-prs--*`、`projeto-code--*` |
| P2 | B | 仍存在 | “Já sabe o id?” 这一行仍然贴着闸门卡片的底部。 | `projeto-prs--dark--desktop.png` |

### 审批 {#approvals}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| A1 | A | 已修复 | 轨道、审批标签页和 “Precisa de você” 都显示 **4**，即数据库中的数字，包括另一个会话的 `git_push`；会话中的侧边会话面板显示属于其他会话的 3 个。 | `projeto-approvals--*`、`detalhe-precisa-de-voce--dark.png`、`detalhe-sessao2-topo--dark.png` |
| A2 | A | 已修复 | `git_push` 的卡片提供 Aprovar/Negar/Modo automático，没有 “Sempre permitir”。 | `projeto-approvals--*` |
| A3 | M | 仍存在 | 仍有多种变体：标签页中 4 个按钮外加一段等宽字体的长注释，“Precisa de você” 中 3 个按钮且没有注释，侧边会话面板中 3 个拉伸的按钮。“Sempre permitir” 的注释仍然说两件事：对话流中是 “grava a regra em .brabo/permissions.json”，面板中是 “libera este tipo de ação só para dev-api”。 | `detalhe-sessao2-topo--dark.png`、`detalhe-precisa-de-voce--dark.png` |
| A4 | B | 仍存在 | ⚠ 字形仍约 8 px，而等宽字体的段落比决策本身更显眼。 | `projeto-approvals--*` |
| A5 | B | 仍存在 | 命令仍以直引号出现在比例字体中。 | 同上 |

### 会话 {#session}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| X1 | A | 已修复 | 在 1440、1280 和 1024 下栏都放得下：模型和回复语言合并为一个 chip，标题和元数据完整显示，“Encerrar” 在 1024 下变为图标。唯一剩下的截断是 chip 自身的省略号（“… · pt…”，217 中放 230 px）。 | `sessao*--*--desktop.png`、`detalhe-sessao-1280--dark.png`、`detalhe-sessao-1024--dark.png`、`sondas-dark.json` |
| X2 | A | 部分修复 | 面板现在与对话流同宽（x 302–1082），按会话分组提议（“2 propostas na sessão #cde43f7c”），也不再重复标签。但它仍是 composer 上方一个**占 900 px 中 345 px** 的固定块，其后的条目从上边缘露出（y≈387）。 | `detalhe-sessao2-topo--dark.png`、`detalhe-sessao-fim--dark.png`、`sondas-dark.json` |
| X3 | A | 已修复 | 没有按来源的分组；对话流按顺序读作问题 → 回答。 | `detalhe-sessao2-topo--dark.png`（`sondas-dark.json` 中的 `grupos: []`） |
| X4 | M | 部分修复 | handoff 卡片不在这些数据中（提议已被取代），但 composer 仍写着 “Endereçar handoff”。 | `sessao*--*` |
| X5 | M | 未复核 | 没有可用来比较宽度的 handoff 卡片。 | — |
| X6 | M | 仍存在 | “ARTEFATOS GERADOS 3” 只列出一个组（“PO 1”）；在第二个会话中 brief 存在，面板却写着 “0 · Nada ainda”。 | `sessao--*`、`sessao2--*` |
| X7 | B | 部分修复 | “ORIGEM: 0 REF(S)” 变成了 “ORIGEM: 0 REFERÊNCIA”——没有行话了，但数量形式错误；见 N9。 | `sessao2--*` |
| X8 | B | 仍存在 | 同一个会话在两种主题下打开时滚动位置不同。 | `sessao2--dark--desktop.png` × `sessao2--light--desktop.png` |

### /containers、/account、/status {#containers-account-status}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| K1 | M | 已修复 | “Parar” 和 “Remover” 为 `disabled`（不透明度 0.5），该行写着 “Nunca provisionado: não há container para parar nem remover”。 | `containers--*--desktop.png`、`sondas-dark.json` |
| K2 | M | 已修复 | broker 的原因只有一行，带一个可展开的 “Por quê?”；界面中没有任何 `BROKER_URL`。 | 同上 |
| K3 | B | 仍存在 | 项目链接为 53×14 px。 | `validacao-visual.json` |
| U1 | M | 已修复 | “só esta página está traduzida” 这句话消失了。 | `account--*` |
| U2 | B | 已修复 | 副标题中没有 RN 编号（“Agente local”）；表格前的长段落保留。 | 同上 |
| T1 | B | 仍存在 | 原始 ISO 时间戳、“Último check”、engine 显示 “—”，以及作为小链接的 “Voltar”。在 390 px 下页面还会溢出——见 N5。 | `status--*` |

### 设置 {#settings}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| G1 | A | 部分修复 | 界面自身的路径已修复：一次加载（52 个请求）再点击 “Nesta página” 的 11 个条目，在 28 s 内只多花 **18** 个请求，没有 429。通过直接链接（`?section=`）重新加载仍然**每次加载花 52 个**（之前 55 个）：16 s 内的第六次重载超出了限制，页面显示 “Limite de requisições excedido”（`g1.json`：30 s 内 362 个请求，51 × 429）。 | `g1-cliques.json`、`g1.json`、`detalhe-g1-ultima-secao--dark.png` |
| G2 | M | 部分修复 | 四列消失了：“Nesta página” 位于各分区之上。“Modelos por agente” 仍会截断 agent 名称（“QA de Performance e Segurança”，119 中放 201 px）和模型（143 中放 173）。在移动端表格会坍缩——见 N4。 | `projeto-settings--*--desktop.png`、`validacao-visual.json` |
| G3 | M | 部分修复 | “Tarefas bloqueadas seguidas até parar” 取代了 “Tasks blocked”；“dev agent(s)”、“bind-mount”、“permissions.json” 和 “runner” 仍留在 “Execução” 和 “Onde o código mora” 分区中。 | `projeto-settings--*--desktop.png` |
| G4 | M | 仍存在 | “Execução” 中的 “Salvar” 在没有任何待处理项、也没有计数时处于激活状态（赤陶色）；“Converter” 是无效的。 | 同上 |
| G5–G7 | B | 未复核 | 锚定分区的摘要、能力 chip 以及 PAT 的占位符没有在相同条件下重新截图。 | — |

### 架构、Backlog、花费、浅色主题 {#architecture-backlog-spend-light-theme}

| # | 严重度 | 状态 | “之后”显示了什么 | 证据 |
|---|---|---|---|---|
| R1 | B | 仍存在 | “a partir do module_map (create_c4_diagram)”。 | `projeto-arquitetura--*` |
| R2 | B | 仍存在 | 顶部有孤立段落，“Gastos do workspace” 位于项目标签页内，一张只有坐标轴的图表。 | `projeto-spend--*` |
| R3 | B | 仍存在 | 故事的图标仍是 Criativo 的灯泡。 | `projeto-backlog--*` |
| CL1 | M | 仍存在 | 无效的 “Converter” 在浅色背景上仍几乎看不见。 | `projeto-settings--light--desktop.png` |

## 新发现 {#new-findings}

“之前”没有列出的东西——要么是新的，要么是在某次修复让界面可达之前一直被掩盖的。
这里一条也没有修复；每一条都是 AT 的候选。

| # | 严重度 | 界面 / 主题 | 发现 | 证据 |
|---|---|---|---|---|
| N1 | A | 会话，两种主题，390 px | 会话页面没有获得移动端布局。“Contexto da sessão” 保持约 320 px，对话流只剩约 70 px、每行折一个词，侧边会话面板无法阅读，“Iniciar ideação”/“Encerrar” 掉出右边缘。 | `sessao--*--mobile.png`、`sessao2--*--mobile.png`、`detalhe-sessao2-mobile--*.png`；检查器 19–21 `texto-cortado` |
| N2 | M | 会话，两种主题 | 每个 `chat.message` 都按**查看者**绘制——头像和名字来自登录用户，从不来自 `actorKind`/`actorId`（`apps/web/src/routes/session-timeline-montagem.tsx:379-395`）。agent 的 `chat.message` 显示为 “owner@brabo.dev”；在共享会话中，别人的消息会显示为查看者的名字。在对话流把历史折叠为按来源分组时（X3），这一点被掩盖了。 | `detalhe-sessao2-topo--dark.png`；`sondas-dark.json`（`autoriaChatMessage`：对用户、agent、用户三次都是 “owner@brabo.dev”） |
| N3 | M | /containers，两种主题，390 px | 表格把七列挤进宽度内：表头 “REGISTRADO/OBSERVADO/RECURSOS/DESDE” 相互重叠，单元格每行折一个词，操作按钮在右侧被截断。 | `containers--*--mobile.png`；检查器 8 `texto-cortado` |
| N4 | M | 设置，两种主题，390 px | “Modelos por agente” 在移动端无法使用：agent 名称只得到 6 px 的框，模型的触发器 0 px。 | `projeto-settings--*--mobile.png`；检查器 33–35 `texto-cortado` |
| N5 | B | /status，两种主题，390 px | 唯一横向滚动的页面：`scrollWidth` 413 对 390；表格右边缘被截断。 | `status--*--mobile.png`、`validacao-visual.json` |
| N6 | B | Dashboard，两种主题，390 px | 搜索框缩成 “Bus”，“Novo projeto” 折成两行。 | `dashboard--*--mobile.png` |
| N7 | B | Criativo，两种主题，390 px | 每行的会话 id 得到 0 px 的框（“#ae1e5746”、“#cde43f7c”），于是各行失去了标识它们的东西。 | `projeto-criativo--*--mobile.png`、`validacao-visual.json` |
| N8 | B | 项目轨道，两种主题，390 px | 激活的标签页没有被完整滚入视野（“Config…” 被截断，审批的 “4” 被裁掉），也没有任何提示表明该条可以滚动。 | `projeto-settings--*--mobile.png`、`projeto-approvals--*--mobile.png` |
| N9 | B | 概览与会话，两种主题 | i18next 那一轮处理留下的复数失误：“1 eventos”（`overview.json:70` 只有一种形式）和 “0 referência”（pt 的规则把 0 归入 `one`，所以 `origemRefs_one` 被用于零）。 | `projeto-overview--*--desktop.png`、`sessao2--*` |
| N10 | B | 登录，两种主题 | 背景光晕是 `--success-soft`（`apps/web/src/routes/AuthLayout.module.css:80-84`）：配旧的蓝绿色时它读起来像品牌色；在中性主题中，它是赤陶色页面后的一团绿雾。 | `login--dark--desktop.png`、`login--light--desktop.png` |
| N11 | B | 审批标签页，两种主题 | 每张卡片都带有 “Motivo da política fora dos eventos carregados nesta tela”——这是真的（原因在另一个会话的日志里），但这是工具在解释自己，而且每张卡片都重复。 | `projeto-approvals--*` |

## 本页不测量什么 {#what-this-page-does-not-measure}

- 对比度。那是基于 token 的算术，位于 web 的测试套件中
  （`apps/web/src/lib/contraste.ts`）；这里的检查器只看布局。
- engine 之后的任何东西：实时回合条、终端、dev agent 的在场状态。stub 无法产生它们。
- 生产构建。开发用的 `vite` 提供相同的组件和 CSS，但不提供生产的 CSP，也没有 web
  镜像前面的 nginx。

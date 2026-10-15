# ADR 0216 — 四种语言，以 pt-BR 作为**来源**和默认：文档与界面提供葡萄牙语、英语、俄语和简体中文

## 状态 {#status}

**Accepted.** 2026-10-15（AT-545，史诗 EP-032；负责人 10月15日的决定）。
负责人要求文档（站点和 README）以及界面提供四种语言——巴西葡萄牙语（**默认**）、英语、俄语和普通话（简体中文）——分**阶段**进行，并回答了本 ADR 的四个开放问题（见“决策”第 4、9 和 10 项）。README 与经测量的本地化模型：仓库
`storytold/photocraft`（`README.md`、`docs/localization.md`、
`docs/localization-parity.md`）。

主题：`docs`。撤销来自 i18n 基础（RN-432）且没有 ADR 的界面英语默认，以及站点的 `defaultLocale: 'en'`。没有任何已接受的 ADR 被编辑：RN-432 将在界面的 PR 中通过新的 RN 获得修订。

## Context {#context}

在 `origin/dev`（`f0a355fe5a`）上测量：

- 站点声明 `defaultLocale: 'en'` 和 `locales: ['en', 'pt-BR']`
  （`website/docusaurus.config.ts:109-116`），`docs/` 是默认 locale 的树。但在 `docs/` 的 261 个文件（5,7 M 字符）中，**92 个正文是 pt-BR**——RN（`business-rules.md`，1,58 M，以及
  `business-rules/autenticacao.md`）、自 0127 起的 ADR 和阶段历史——约 2,7 M 字符。“en”站点以葡萄牙语提供这些文本。站点的外壳（侧边栏、导航栏、页脚）也是 pt-BR，没有任何翻译文件。
- `website/i18n/pt-BR/` 中的翻译覆盖 261 页中的 135 页，其中 **97 页**的来源在翻译最后一次提交之后被修改过。没有任何东西告诉读者或 PR 作者这一点：docmap 的 `traducao-pt-br` 规则是 `warn`，什么也不测量。
- 在有 pt-BR 副本的 100 份 ADR 中，**66 份逐字节就是创建该 ADR 的提交中的文本**：ADR 0001–~0103 是用葡萄牙语写的，`docs/adr/` 中的是英文译本。
- 界面只在 web 中以 `en` 为默认（`apps/web/src/lib/idioma.ts:38`、
  `i18n.ts:52`）；api 已经把 `pt-BR` 记为 `users.locale` 的默认值
  （`apps/api/src/db/schema/iam.ts:87`）。共有 27 个命名空间中的 2.310 条文本，每种语言约 9 万字符。
- agent **回复**的语言已经是开放的 BCP-47 列表（ADR 0177，RN-618/622），不依赖界面语言。
- Docusaurus 主题带有 `pt-BR`、`ru` 和 `zh-Hans` 的翻译
  （`@docusaurus/theme-translations@3.10.2`）；那里不存在 `zh-CN`。本地搜索（`@easyops-cn/docusaurus-search-local`）用 jieba 对中文分词，并通过 `lunr-languages` 为俄语建立索引。

## Decision {#decision}

1. **pt-BR 是两个产品中的**来源**和默认。** 在站点中，`docs/` 成为 pt-BR 的树（`defaultLocale: 'pt-BR'`），`en`、`ru` 和 `zh-Hans` 住在
   `website/i18n/<locale>/` 中。备选方案——保持英语作为来源，只通过 `localeConfigs.<locale>.baseUrl` 以 pt-BR 打开站点——在 Docusaurus 3.10 中可行但被拒绝：每段新文本都会以英语诞生，而 2,7 M 字符的葡萄牙语会继续在英语标签下提供。在界面中，`pt-BR` 是 web 的默认值和 `fallbackLng`，也是一致性测试的参照。
2. **代码是 `pt-BR`、`en`、`ru` 和 `zh-Hans`**，在 Docusaurus、i18next、`<html lang>` 和 `users.locale` 中都相同。本地搜索使用它自己的代码（`pt`、`en`、`ru`、`zh`）。
3. **界面中的 locale 解析：** 账户中记录的选择总是胜出，绝不被检测覆盖。没有选择时，浏览器给出建议：`pt*` →
   `pt-BR`；`zh`、`zh-CN`、`zh-SG` 和 `zh-Hans*` → `zh-Hans`；`ru*` → `ru`；`en*`
   → `en`。
4. **没有目录的语言回落到 pt-BR**（负责人的决定）：德语、繁体中文以及其他任何语言都以默认语言打开，而不是英语。某个 locale 中缺失的文本回落到 pt-BR 来源——而在界面中不会缺失，因为一致性检查会拒绝。
5. **站点的切换是一个 PR，通过 `git mv`：** 当前的英语移到 `website/i18n/en/`；**最新**的 pt-BR 翻译取代来源；过时的和不存在的让页面保持它当前的语言直到它所属的批次，并带有提醒；`website/i18n/pt-BR/docusaurus-plugin-content-docs` 在**同一个** PR 中移除，否则默认 locale 的文件夹会覆盖 `docs/`，97 份过时副本会上线。
6. **未翻译的页面，或来源在翻译之后发生变化的页面，会**说明**这一点**，用读者的语言：`DocItem/Content` 的一个 wrapper 通过 `metadata.source` 区分来源与翻译，每个翻译页面在 frontmatter 中带有 `traducao_de: <commit da fonte>`。
7. **一致性被**测量**，报告是**生成**的**，由 `pnpm docs:generate` 生成
   （`docs/reference/paridade-de-traducao.md`，`generated: true`；`--check`
   拒绝过时的文件）：按 locale，已翻译的页面和字符相对来源的比例、过时页面、修订日期、母语审校，以及按决定不翻译的内容；在界面中，按命名空间对照 pt-BR 的键，以及 `Intl.PluralRules` 的复数形式（`pt-BR`：one/many/other；
   `en`：one/other；`ru`：one/few/many/other；`zh-Hans`：other）。成文的规则住在 `docs/explanation/localizacao.md` 中，每种语言一份术语说明——永不翻译的有：Brabo、术语表中的 agent 和角色名称、用户数据、命令以及 RN/ADR 编号。
8. **README 是橱窗，采用 photocraft 的模型**，以 pt-BR 为来源，另有
   `README.en.md`、`README.ru.md` 和 `README.zh-Hans.md`。翻译不带版本号也不带派生计数：它们链接到被核对的 pt-BR。
9. **ADR 0001–~0103 在 `docs/adr/` 中恢复为原始的 pt-BR 文本**
   （负责人的决定），英语移到 `website/i18n/en/`。这不是编辑已接受的决定：而是恢复当初被接受的文本，它今天在 pt-BR 副本中。只适用于逐字节等于创建提交文本的副本；有出入的保持原样，并在一致性报告中说明。
10. **在英语批次到来之前，英语站点以葡萄牙语显示 RN 和近期的 ADR，并带有提醒横幅**（负责人的决定）。旧链接 `/brabo/<ambiente>/pt-BR/…` 由根目录的 404 重写为 `/brabo/<ambiente>/…`，如同 ADR 0073 的 `/main/` → `/prd/`；英语从根目录移到 `/brabo/<ambiente>/en/…`（负责人的决定）。
11. **阶段。** 第 1 阶段：站点切换、四种语言的入口页面（`intro`、
    `getting-started`、`glossary` 以及从零到交付物的教程）、四份 README、完整的 `ru` 和 `zh-Hans` 界面，以及经测量的一致性。第 2 阶段起：按侧边栏类别 × locale 分批，每批一个 PR——先是 97 个过时页面和 26 个仅有英语的页面的 pt-BR，然后是 pt-BR 页面的英语，然后是 `ru` 和 `zh-Hans`。

## Consequences {#consequences}

- docmap 把规则 `traducao-pt-br` 换成 `traducao`，`warn` 且**绝不**
  `block`：在每个文档 PR 中要求翻译，每次变更将要付出四次翻译的代价。抑制滞后的是生成的报告和页面上的横幅。
- 锚定在代码上的句子（`verificarFrasesAncoradasNoCodigo`、计数）位于变成 pt-BR 的页面上时，会以 `CEGO` 失败，直到在该批次的 PR 中模式跟上——刻意如此。今天有 19 句。`procedimentos-do-runbook.mjs` 查找的标题以及索引切换后 `docs/adr/temas.yml` 的标题同样如此。
- `ancoras-de-rn.mjs` 开始核对三个翻译 locale 的 RN，`links-do-locale.mjs` 开始把 `en`、`ru` 和 `zh-Hans` 作为带前缀的 locale 识别。
- `users.locale` 增加 `ru` 和 `zh-Hans`（Postgres 枚举、DTO、生成的类型）。回复语言的机制不变——`ru` 账户已经通过 BCP-47 收到通用指引——原生指引文本以及西里尔字母和汉字的检测作为经测量的改进，而不是前提。
- 声明的代价：站点构建编译四个 locale（约为今天的两倍，未测量）；搜索索引增大（未测量）；全部翻译约为英语 2,9 M 字符、俄语和中文各 5,3 M；每个改变已翻译来源的 PR 都需要运行 `pnpm docs:generate`；英语从环境根目录移到 `/en/`。
- 没有母语审校，俄语和中文以经 agent 审阅的机器翻译发布，报告显示“母语审校：否”，直到有人审校。

## 超出范围 {#fora-do-escopo}

- `docs/reference/**`（生成的）继续不在翻译范围内，生成器继续以英语写入。
- 四种之外的语言、繁体中文以及从右到左的书写。
- 翻译用户和 agent 产出的内容（工件、消息）：那是**项目**和回复的语言（ADR 0177），而不是界面的。

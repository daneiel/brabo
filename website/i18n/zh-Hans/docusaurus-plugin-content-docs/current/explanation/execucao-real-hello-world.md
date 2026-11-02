---
id: execucao-real-hello-world
title: 真实执行——hello world
sidebar_label: 真实执行（hello world）
description: Brabo 第一次用 API 模型端到端执行、它产生的十六个发现，以及仍未被证明的内容。
keywords: [dogfooding, 真实执行, 发现, fase 13]
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 真实执行——hello world

agent 链第一次以 **API 模型**端到端运行，代替本地的 Ollama。新项目（`Hello API`），GitHub 上的真实仓库，provider OpenRouter，模型 `~deepseek/deepseek-v4-flash-latest`。

目标不是交付 hello world。而是发现当产品像用户那样被使用时什么会坏——这一点它做到了，而且数量可观。

:::caution 这次执行**不是** FASE 13b 的官方测量
中途 engine **多次重启**，以加载执行本身所要求的修正。“零重启”标准已经丢失，下面的表格有意测量的是一次坎坷的运行。真正有效的测量仍需进行，在一切都已修正且没有中断的情况下。
:::

## 链走到了哪里 {#até-onde-a-cadeia-chegou}

| 步骤 | 结果 |
|---|---|
| GitHub 开通 | ✅ `daneiel/hello-api`，Gitflow 的 5 步中完成 4 步 |
| Criativo | ✅ 4 条业务规则，带可追溯性 |
| 就绪 → brief | ✅ `product_brief` 引用了这 4 条规则 |
| PO | ✅ 1 个史诗，4 个带 RF/DOR/DOD 的故事 |
| 手动晋升 | ✅ 4 个故事由用户晋升（RN-048） |
| Arquiteto | ❌ 从未接到接力棒 |
| Dev、PR、gate | ❌ 未达到 |

bootstrap 的第 5 步（保护分支）因 GitHub **套餐**的限制而失败：私有仓库在免费套餐中不接受分支保护。这不是产品的缺陷——但产品把它当作硬失败，没有事先提醒。向导开始在做选择时提醒。

## 成本，从 `token_usage` 中提取 {#o-custo-extraído-do-token_usage}

| agent | 调用次数 | 输入 token | 输出 | 成本（微美元） |
|---|---|---|---|---|
| **anamnese** | 32 | **392.510** | 18.207 | 38.605 |
| psicologo | 2 | 16.406 | 5.140 | 2.401 |
| po | 5 | 18.777 | 3.492 | 2.318 |
| criativo | 6 | 6.406 | 3.343 | 1.180 |
| psicologo-leve | 1 | 1.947 | 2.039 | 542 |

Anamnese 花费的是 **Criativo 与 PO 之和的 8 倍**，却什么都没产出——它无法说出“没有可发出的东西”（[RN-063](../business-rules/custo.md#rn-063)）。这是这张表中最重要的数字：工作花了几美分，浪费花了其余部分。

## 十六个发现 {#os-dezesseis-achados}

按出现顺序编号。已修正的由用户逐一决定。

### 在这次执行中修正的 {#corrigidos-nesta-execução}

| # | 内容 | 落在哪里 |
|---|---|---|
| 4 | 向导把 `brabo/<slug>` 显示为仓库的目的地，`brabo/` 是硬编码的——api 在 `createForAuthenticatedUser` 中创建 | 未关闭 |
| 6 | 开通失败后界面永远停在“Trabalhando…”，零事件 | 未关闭 |
| 8 | bootstrap 在**每个新的 GitHub 项目**上都会死：空仓库对整个 Git Data API 都响应 409，而 provider 只处理 404 | PR #125 |
| — | GitHub 的假实现在真实实现响应 409 的地方响应 404——测试套件为绿而产品是坏的 | PR #125 |
| — | 免费套餐不保护私有仓库的分支，而选择时没有提醒 | PR #125 |
| 13 | **没有任何 agent 能使用带凭据的 provider**：回合在一个 UUID 列中按 agent 的 slug 查找密钥 | PR #126 |
| 14 | 回合失败在日志中变成空的 `agent.response`，原因只在临时广播中 | PR #127 |
| — | Criativo 的聊天以空白打开，没说轮到用户了 | PR #127 |
| 12 | Criativo 在决定技术（`GET` 还是 `POST`？JSON 还是文本？）——身份没有说明什么**不**属于它 | PR #131 |
| — | **工具**的失败被用 `_ =` 丢弃：四条规则被静默拒绝 | PR #131 |
| — | engine 重启会杀死对话，界面上什么都没有 | PR #131 |
| 15 | Anamnese 没有结束的动词：每个 tick 都重复一个不可能的调用直到上限 | PR #132 |
| 16 | 30 秒的心跳会杀死有待处理 handoff 的会话——工作变得无法到达 | PR #133 |

### 未关闭，待分类 {#abertos-para-triagem}

| # | 内容 |
|---|---|
| 1 | 侧边菜单的“Configurações”不导航；（workspace 的）目录只能在项目内部到达 |
| 2 | 设置中没有 **git** 凭据的部分——只有 LLM 的 |
| 3 | 向导承诺“selecione uma credencial já cadastrada”和“verifique nas configurações”，而两者都不存在 |
| 4 | 向导的预览**以及确认界面**中硬编码的 `brabo/` |
| 5 | 策略步骤宣布了被 ADR 0030 移除的分支 `rc` 和级联 `rc ← qa` |
| 6 | 在 `repo_bootstraps` 行之前的失败会让界面永远转圈，没有任何事件 |
| 7 | 活动 feed 对每个事件都显示“atividade em system” |
| 11 | 会话因**标签页**不活动而关闭（RN-064 部分解决：只在有待处理 handoff 时保护） |
| — | Anamnese 在工作会话**内部**运行，穿插事件并争夺预算 |

## 这次执行证明了什么，以及没有证明什么 {#o-que-esta-execução-provou-e-o-que-não-provou}

**证明了** Criativo → PO 链在 API 模型下可以工作，并产出真实质量的构件：backlog 带着闭合的可追溯性产出，故事的 DOR 写着“formato e detalhes técnicos definidos pelo Arquiteto”——加在 Criativo 上的边界穿过了 brief，到达了 backlog。

**证明了**产品在三个不同的层（回合、工具、进程）吞掉错误，而正是这一点让缺陷保持不可见。这三层现在都会说话。

**没有证明** Arquiteto、dev、远程 PR 以及 gate。**没有证明**任何关于一次完整执行的真实成本的东西。而且由于中途重启，它不能作为 FASE 13b 的测量。

> **TODO(humano):** 干净的执行——没有重启，一切都已修正——仍需运行，正是它用 `pnpm --filter api medir:execucao` 提取的表格来填充 `docs/explanation/validacao-real.md`。

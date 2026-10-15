---
traducao_de: 9d4f011ddd0f94cccc993a6640002463803b1925
---

# ADR 0210 — 用 `motion` 做文本动画

## 状态 {#status}

**已接受。** 2026-10-03（AT-401；所有者于 10月3日的决定：在所有“进行中”的文本上使用 AI Elements 的 Shimmer，配合 `motion` 库）。

## 背景 {#context}

表示“agent 正在工作”的文本（“Pensando…”、“Reunindo informações…”、“trabalhando”状态）原先是静态的，或带着三个跳动的点。所有者选择了 AI Elements 的 Shimmer（<https://elements.ai-sdk.dev/components/shimmer>）。原版使用 `motion/react`、Tailwind 和 shadcn 的 `cn`；Brabo 的 web 没有 Tailwind、shadcn 也没有 `clsx`——它是基于 `design/tokens.css` 的 CSS Modules。

## 决策 {#decision}

- `motion` 进入 `apps/web`，并只藏在**一个**组件之后：
  `apps/web/src/components/ui/Shimmer.tsx`；没有其他文件导入它。
- `LazyMotion` + `domAnimation` + `m.create(tag)`（在模块中按 tag 缓存），只加载 DOM 动画的子集。
- **独立的** vendor 组 `vendor-motion`，列在 `codeSplitting.groups` 的允许清单中（AT-300）。该 chunk 不进入初始加载：只有使用 Shimmer 的界面（会话、概览、执行者）才拉取它。
- 渐变使用 token：底色 `--text-secondary`，高光 `--text-primary`。最差的点（底色）在 `design-contraste.test.ts` 中针对 `--surface-0/1/2` 在两种主题下测量。
- 本 PR 应用于 agent 的回合；加载文本和其他进行中的状态在各自的 PR 中处理。

## 后果 {#consequences}

- 实测体积（`pnpm --filter web build`）：初始 chunk `index` 52,81 → 52,89 kB（gzip 16,73 → 16,75 kB）；新的 `vendor-motion` 为 76,23 kB（gzip 26,53 kB），不在 `index.html` 中。
- 减少动态效果：`useReducedMotion()` 返回底色的静态文本，CSS Module 中有 `@media (prefers-reduced-motion: reduce)`。
- 消息流中的三个点 `.typing/.typingDot` 被移除；keyframe `bpulse` 保留，因为其他组件在用。

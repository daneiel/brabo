---
traducao_de: 9d4f011ddd0f94cccc993a6640002463803b1925
---

# ADR 0210 — Анимация текста с `motion`

## Статус {#status}

**Accepted.** 2026-10-03 (AT-401; решение владельца от 03.10: использовать Shimmer из
AI Elements во всём тексте "в процессе", с библиотекой `motion`).

## Контекст {#context}

Текст, говорящий "агент работает" ("Pensando…", "Reunindo
informações…", статус "trabalhando"), был статичным или шёл с тремя
пульсирующими точками. Владелец выбрал Shimmer из AI Elements
(<https://elements.ai-sdk.dev/components/shimmer>). Оригинал использует
`motion/react`, Tailwind и `cn` из shadcn; у web Brabo нет Tailwind,
shadcn и `clsx` — это CSS Modules поверх `design/tokens.css`.

## Решение {#decision}

- `motion` входит в `apps/web` и живёт за ОДНИМ компонентом,
  `apps/web/src/components/ui/Shimmer.tsx`; ни один другой файл его не импортирует.
- `LazyMotion` + `domAnimation` + `m.create(tag)` (кэшируется по тегу в
  модуле), чтобы загружать лишь подмножество DOM-анимации.
- СОБСТВЕННАЯ группа vendor, `vendor-motion`, в списке разрешённых
  `codeSplitting.groups` (AT-300). Чанк не входит в начальную загрузку: его подтягивают лишь
  экраны, использующие Shimmer (сессия, Visão geral, Executores).
- Градиент использует токены: основа `--text-secondary`, блик `--text-primary`.
  Наихудшая точка (основа) измеряется в `design-contraste.test.ts` на
  `--surface-0/1/2`, в обеих темах.
- Этот PR применяет к ходу агента; тексты загрузки и прочие
  состояния "в процессе" придут в собственных PR.

## Последствия {#consequences}

- Измеренный вес (`pnpm --filter web build`): начальный чанк `index` 52,81 →
  52,89 kB (16,73 → 16,75 kB gzip); новый `vendor-motion`, 76,23 kB (26,53 kB
  gzip), вне `index.html`.
- Уменьшенное движение: `useReducedMotion()` возвращает статичный текст в
  основном цвете, а в CSS Module есть `@media (prefers-reduced-motion: reduce)`.
- Три точки `.typing/.typingDot` ленты ушли; keyframe `bpulse`
  остаётся, потому что его используют другие компоненты.

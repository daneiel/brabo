# ADR 0242 — Containers em tabela linear com `@tanstack/react-table`

## Status

**Accepted.** 2026-11-02 (AT-714; v7 aprovada pelo dono).

## Context

A v7 troca os cartões de Containers e Providers por tabela linear (uma linha por
item, ações só ícone com `legenda`). Containers precisa ordenar e paginar.

## Decision

- Containers usa `@tanstack/react-table` (`^9.3.1`, entrada `legacy`) só para
  decidir ordem e página no CLIENTE; nenhuma query nova. Providers fica em tabela
  linear sobre o componente `Table` existente, sem a biblioteca.
- Justificativa da dependência nova, medida no `vite build`: a tela é chunk
  próprio (`ContainersPage` 4,4 kB, 1,7 kB gzip) e a biblioteca cai no grupo de
  vendor `vendor-tanstack` (236 kB, 66 kB gzip no total, com router e query, já
  existente); o delta isolado da biblioteca não foi medido. `pnpm audit --prod`:
  nenhuma vulnerabilidade conhecida; ~140 kB em disco em `node_modules`.

## Consequences

Mais uma dependência a manter; tabela futura que só lista não precisa dela.

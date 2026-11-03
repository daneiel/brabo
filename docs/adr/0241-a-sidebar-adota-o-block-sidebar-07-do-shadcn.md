# ADR 0241 — A sidebar adota o block `sidebar-07` do shadcn

## Status

**Accepted.** 2026-11-02 (AT-714; v7 aprovada pelo dono). Revisa o
[ADR 0211](0211-uma-navegacao-so-a-sidebar-absorve-o-trilho.md) — que
continua aceito e não é editado — apenas nas larguras e no mecanismo de recolher.

## Context

O ADR 0211 fez da sidebar a única navegação do projeto, com 264px abertos e 62
recolhidos (aba Código: 312px de moldura, ou 110 recolhida). A v7 (desenho linear
e blocks do shadcn) foi aprovada e a sidebar passa a ser o block `sidebar-07`.

## Decision

- Larguras: **256** abertos e **48** recolhidos (antes 264/62).
- Aba Código: **304px** de moldura (256 + 48 do trilho do `CodeShell`), ou **96**
  com a sidebar recolhida (48 + 48). Soma das larguras, não medida no navegador.
- Mantém-se o estado de recolher que já existia (preferência lembrada) e o
  atalho Ctrl/Cmd+B, agora do kit.
- O kit grava o cookie `sidebar_state`; fica gravado **sem leitor** (a fonte do
  estado continua a de `lib/sidebar-state`).
- Decisão do dono (03/11, revisa a de 02/11): "Configurações" é UM item da barra
  lateral, como as outras abas — a sidebar não ganha sub-itens nem cresce. Os
  grupos — Modelos, Projeto, Pessoas e Avançado — são ABAS dentro da página,
  numa faixa no topo, e cada um vive em `?tab=settings&group=<grupo>`. A
  implementação é da AT-719.
- Decisão do dono (03/11): o rodapé vira o menu do usuário do `sidebar-07` (gatilho = cartão
  com avatar, e-mail e papel; itens Conta, Tema e Sair; recolhida, só o avatar e o menu abre
  ao lado). "Recolher menu", Containers, Providers e Gastos seguem como links do rodapé. As
  abas do projeto ficam maiores (corpo, 32px, ícones de 16px) com divisória entre os grupos.
- Ícones Lucide. O que o ADR 0211 decidiu sobre conteúdo (grupos, aba ativa,
  teclado, contadores nunca somados) continua valendo.

## Consequences

Dependência do kit shadcn já presente no web; o cookie sem leitor é lacuna
declarada, não acaso.

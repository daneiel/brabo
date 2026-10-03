# 0211 — Uma navegação só: a sidebar absorve o trilho do projeto

## Status

**Accepted.** 2026-10-03 (AT-404; decisão do dono em 03/10: "A barra
navegável à esquerda que pode ser expandida passa a ser a ÚNICA; retire a outra
barra de navegação, mas contemple nesta todos os itens da barra excluída").
Revisa o [ADR 0126](0126-trilho-vertical-de-navegacao-do-projeto.md) — que
continua aceito e não é editado — e a [RN-201](../business-rules/autenticacao.md#rn-201).

## Context

Desde o ADR 0126 as abas do projeto existiam em DOIS lugares: o trilho vertical
de 180px (`ProjectRail.tsx`, montado em `ProjectPage.tsx`) e a lista por projeto
da sidebar (`LinhaDeAba`, [RN-196](../business-rules/autenticacao.md#rn-196)).
O CLAUDE.md declarava isso como lacuna ("reconciliar é decisão de produto à
parte"), junto com o preço da moldura: 492px na aba Código (264 da sidebar +
180 do trilho + 48 do `CodeShell`).

Medido antes de mudar, o que só o trilho tinha: os três GRUPOS com cabeçalho; a
aba ATIVA marcada (`aria-selected`); os cinco contadores (Insights, PRs,
Aprovações, Backlog, Arquitetura), cada um na sua aba e nunca somados — a
sidebar mostrava só Aprovações, do resumo do dashboard; o teclado
(`ArrowDown`/`ArrowUp`/`Home`/`End` com volta, atravessando grupos); a ativa
rolada para a área visível; o `role="tablist"` vertical; e, no telefone
([RN-643](../business-rules.md#rn-643)), a barra horizontal rolável acima do
painel. A sidebar tinha, e o trilho não: o projeto recolhido na trilha de
62px, a gaveta do telefone e o link para outra janela do navegador.

## Decision

1. **A sidebar é a única navegação do projeto.** `ProjectRail.tsx`, o CSS dele
   e a montagem em `ProjectPage.tsx` saem. A lista do projeto na sidebar vira
   `AbasDoProjeto` (`apps/web/src/routes/AbasDoProjeto.tsx`), com tudo o que o
   trilho tinha: grupos de `GRUPOS_DO_PROJETO`, aba ativa, contadores por aba,
   teclado, `tablist` vertical nomeado pelo projeto, roving tabindex e a ativa
   rolada para dentro. Cada aba é link para `/projects/<id>?tab=<chave>`.
2. **Os cinco contadores têm a MESMA fonte, sem requisição nova.** As cinco
   filas passam a ser lidas por um hook só, `useContagensDoProjeto`
   (`apps/web/src/lib/contagens-do-projeto.ts`), que a moldura usa para o
   painel "precisa de você" ([RN-467](../business-rules.md#rn-467)) e a
   sidebar usa para os números. Mesmas `queryKey`s, deduplicadas. A sidebar só
   o liga enquanto a moldura do projeto está MONTADA — era só nela que o trilho
   existia; noutra tela do projeto (a Sessão, por exemplo) e nos projetos
   fechados fica o número de Aprovações do resumo, como antes. Os orçamentos
   `*.orcamento.test.tsx` passam sem mudar teto nenhum.
3. **A aba ativa vem da moldura.** `ProjectPage` publica a aba que mostra
   (`publicarAbaAtiva`) — a URL não basta, porque o painel "precisa de você"
   troca de aba sem passar pelo router. A sidebar PEDE a aba clicada à moldura
   (`pedirAba`, evento e não estado, para duas molduras nunca se puxarem) e
   navega com `?tab=`. O link do projeto sem `?tab=` volta à aba padrão.
4. **Recolhida, um flyout.** Na trilha de 62px, o quadrado do projeto ABERTO
   abre um flyout com as mesmas abas (fecha no Esc, ao escolher e no segundo
   clique), sem expandir a sidebar. Os outros projetos seguem expandindo.
5. **No telefone, a gaveta.** A barra horizontal da RN-643 sai; as abas moram
   na gaveta, que fecha ao escolher uma.
6. **O trilho de 48px do `CodeShell` fica:** é a atividade do editor, não
   navegação do projeto.

## Consequences

- A moldura da aba Código cai de 492px para **312px** com a sidebar expandida
  (264 + 48) e para **110px** recolhida (62 + 48).
- A lacuna "as abas existem em dois lugares" fecha.
- Trocar de aba exige a sidebar expandida, o flyout ou a gaveta. Quem recolhia a
  sidebar e navegava pelo trilho passa a usar o flyout.
- A lista da sidebar perde a `<Link>` do router por aba: é `<a>` com o clique
  interceptado, que chama `navigate`. Botão do meio/Ctrl seguem abrindo noutra
  janela.
- `rail.ariaLabel` sai dos dois idiomas; a lista é nomeada por
  `sidebar.projects.tabsAriaLabel` ("Abas de {{name}}").

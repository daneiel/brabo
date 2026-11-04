# ADR 0248 — O conteúdo das páginas ocupa a largura inteira

- **Status:** aceito
- **Data:** 2026-11-03
- **Revisa:** o [ADR 0244](0244-coluna-das-abas-do-projeto-alinhada-a-esquerda.md), no ponto da largura máxima de leitura.

## Contexto

Medido no Chrome (1848x981), o conteúdo de cada aba terminava perto da metade
da tela: `max-width: 1040px` na `.coluna` do `ProjectPage` e 720px na Conta. O
dono (03/11) leu isso como página mal diagramada, "sem chegar ao fim".

## Decisão

1. O conteúdo das abas do projeto e da Conta ocupa a largura inteira à direita
   da sidebar, com o padding lateral de hoje. A `.coluna` e a `.page` da Conta
   não têm `max-width`.
2. Ficam os limites de COMPONENTE: parágrafo de texto longo (`62ch`), cards de
   pergunta (560px), modais e campos de formulário.
3. A aba Código e a tela de Sessão não mudam.

## Consequências

- Em telas largas as linhas de tabela e cards se esticam; a leitura de texto
  longo segue protegida pelo `ch` do parágrafo.

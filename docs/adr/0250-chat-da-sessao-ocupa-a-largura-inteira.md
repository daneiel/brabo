# ADR 0250 — O chat da Sessão ocupa a largura inteira

- **Status:** aceito
- **Data:** 2026-11-03
- **Estende:** o [ADR 0248](0248-conteudo-das-paginas-ocupa-a-largura-inteira.md) à tela de Sessão.

## Contexto

O ADR 0248 tirou a coluna das abas do projeto e da Conta e deixou a Sessão de
fora. Medido, o fio, o composer e as pendências ficavam presos a 780px mesmo em
tela larga; o dono (03/11) pediu que o chat ocupe todo o espaço.

## Decisão

1. O fio, as bolhas, a faixa do turno, o composer, os avisos e as pendências da
   Sessão ocupam a largura inteira da área do chat, com o padding lateral de hoje.
2. Ficam os limites de COMPONENTE (cards de pergunta de 560px, rótulos e chips)
   e o painel de contexto lateral.

## Consequências

- Em telas largas as linhas de texto da bolha se esticam.

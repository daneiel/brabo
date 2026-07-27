# Como construir com o design system do Brabo

O Brabo é uma plataforma de engenharia orquestrada por agentes de IA. Quem usa
a interface é um engenheiro acompanhando vários agentes trabalhando ao mesmo
tempo — e decidindo, no fim, o que eles têm permissão de fazer. Isso explica
quase todas as escolhas abaixo.

## O essencial

- **Dark é o tema primário.** `:root` já é o tema escuro; o claro só entra com
  `[data-theme="light"]` no elemento raiz. Nenhum componente pinta o próprio
  fundo de página: todos assumem estar sobre a superfície do DS e herdam a cor
  de texto dela. Envolva a árvore em `BraboSurface` (ou declare
  `background: var(--surface-0); color: var(--text-primary)` no container) —
  sem isso, ícones e textos claros ficam invisíveis.
- **Tudo em português do Brasil.** Rótulos, mensagens, vazios, erros. Vários
  campos de domínio também são em pt-BR (`observacao`, `hipotese`, `sugestao`),
  e alguns enums igualmente: `status` de agente é
  `trabalhando | aguardando | ocioso | falhou`, e passo de bootstrap é
  `pendente | rodando | ok | skip | falha`.
- **Nunca use cor literal.** Toda cor vem de token (`var(--accent)`,
  `var(--danger)`, `var(--surface-1)`). Alguns componentes recebem cor por
  variável de runtime (`--agent-color`, `--urgency-color`) — o valor ainda é um
  token, só chega por `style`.
- **Três famílias, com papéis fixos.** Space Grotesk em título, Archivo em
  corpo, IBM Plex Mono em tudo que é identificador ou é comparado caractere a
  caractere: comando, token, branch, SHA, id, nome de modelo, status técnico.
  Badge e chip usam mono a 10px por design.

## Os padrões do produto

- **A decisão é sempre do usuário.** Ação com efeito externo aparece como
  `ApprovalCard` e espera aprovação; merge em branch protegida é manual por
  garantia de domínio. Não componha telas que sugiram automação dessas duas
  coisas — a interface existe para preservar essa autoridade.
- **Custo é informação de primeira classe.** `TokenMeter` e o custo por agente
  não são detalhe de rodapé: quem usa o Brabo está gastando token de LLM a cada
  turno, e precisa ver isso enquanto acontece.
- **Estado vazio tem texto próprio, sempre.** Nenhum componente do DS colapsa
  quando não tem dado: `Table` mantém o cabeçalho, `ActivityFeed` e o painel de
  notificações têm frase própria. Preserve isso.
- **Erro tem que ser acionável.** A convenção é dizer o que fazer, não só que
  falhou: qual escopo o token não tem, qual gate pediu mudança, por que a task
  bloqueou. `blockedReason`, `rejectionReason` e `error` existem para isso.
- **Falha não é o mesmo que "não foi preciso".** No bootstrap, `skip` é sucesso
  com nota explicando. Tratar `skip` como erro assusta sem motivo.

## Composição

- **Ícone é sempre do set**, com `size` em px (12–22, default 16) e cor
  herdada por `currentColor`. Decorativo ao lado de rótulo → `aria-hidden`;
  sozinho e significativo → `aria-label`.
- **Agente é sempre um `AgentDef`** (`dev-backend`, `dev-frontend`, `qa`,
  `secops`, `infra`, `po`, `arquiteto`, `criativo`, `anamnese`, `psicologo`).
  Nome, papel, ícone e cor saem dele. Não invente agente nem passe nome de
  modelo onde se espera chave de agente.
- **Evento não se estiliza, se tipa.** `EventItem` e `ActivityFeed` derivam
  ícone, cor e narração de `event.type` e `event.payload`. Para mudar a
  aparência de uma linha, mude o tipo do evento.
- **Tempo é relativo e formatado pelo DS.** Passe `createdAt` ISO e deixe o
  componente formatar; onde o texto de tempo é seu (`meta`, `lastActivityText`),
  siga o mesmo tom: "há 18 min", "há 2 h".
- **Overlay pertence à viewport.** Dropdown e painel abertos são posicionados
  em relação à viewport de propósito — dentro de tabela ou lista, um overlay no
  fluxo é recortado nas últimas linhas.

## O que não existe aqui

Não há componente de layout de página, grid ou stack: as telas compõem com CSS
próprio sobre os tokens de espaçamento. Não há `Tooltip`, `Popover` nem
`DatePicker` — se a tela precisar, é peça nova, não variante de algo existente.
`Table` não ordena, pagina nem seleciona: ela desenha linhas e colunas, e o
resto é de quem usa.

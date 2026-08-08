# Componentes — catálogo extraído do claude.ai/design

Fonte: projeto claude.ai/design `1c960ca8-5e00-4558-8ced-80dfbdf01027`
("Brabo Design System"), arquivos `Brabo Design System.dc.html` (seções
"Componentes base" e "Componentes de produto") + os 5 arquivos de tela
(`Brabo App/Project/Session/Approvals/Settings.dc.html`), extraídos via
`DesignSync` em 2026-07-23. Esses `.dc.html` usam a sintaxe de template do
canvas do claude.ai/design (`sc-for`, `sc-if`, `{{ }}`, atributos
`style-hover`/`style-focus`) — não são código executável. Este
arquivo é a base pra implementação real em React/TSX — todo valor de cor/
espaçamento referencia os tokens de `tokens.css`, nunca hex cru.

**Desde 2026-08-08 (FASE 16) a referência viva é o handoff versionado em
`design_handoff_brabo/`** — README com a especificação e 8 arquivos `.dc.html`
de alta fidelidade. O que este arquivo diz continua valendo; o que o handoff
acrescenta está nas três seções de fundação abaixo. Regra que o próprio README
do handoff estabelece e que vale aqui: os `.dc.html` são **referência de
design, não código de produção para copiar** — a implementação usa os padrões
do `apps/web`.

Convenção geral confirmada em todas as telas: ícones outline (stroke 1.6–2.0,
grid 24px, `currentColor`, `stroke-linecap`/`stroke-linejoin: round`), botões
com 3 variantes (primary/secondary/ghost) × 4 estados (default/hover/focus/
disabled), `:hover`/`:focus` real via CSS (o `style-hover` do mockup não existe
em CSS/React — precisa de CSS Modules ou styled approach equivalente, nunca
inline-only). Nenhum asset binário: todo ícone é SVG inline, e o único asset de
marca é o monograma documentado abaixo — que é **componente, nunca imagem
rasterizada**.

## Tipografia — a escala do handoff

As três famílias e o que cada uma carrega. A carga é auto-hospedada
(`@font-face` em `apps/web/src/index.css` apontando para `public/fonts/`); o
handoff pede o `<link>` do Google Fonts e **essa é a única divergência
deliberada** — ver o ADR 0036 e o cabeçalho de `tokens.css`.

- **Space Grotesk** (`var(--font-heading)`) — títulos, nomes de agente e de
  projeto, wordmark. Pesos 600/700. Título de seção 18px/600; H1 22px/700
  `letter-spacing:-.02em`; wordmark 700 `letter-spacing:-.045em`.
- **Archivo** (`var(--font-body)`) — corpo, labels, botões. Pesos 400/500/600.
  Corpo 13px, label 12px, botão 13px/600.
- **IBM Plex Mono** (`var(--font-mono)`) — código, diffs, terminal, contadores
  de token, caminhos, chaves, IDs e badges de status. 10–13px. Label de
  cabeçalho de tabela: 10px/600, `letter-spacing:.05em`, uppercase.

A regra por trás da lista: mono não é só para código. Ele marca **valor que a
pessoa vai comparar, copiar ou digitar** — hash, path, id, contagem. É o que
mantém título e dado distinguíveis mesmo em 10px.

## Alturas, raios, sombras e transições

Grade de 8px. Padding de card 14–18px; padding de célula de tabela 10–11px ×
14px.

| altura | onde |
|---|---|
| 44px | barra de topo; botão primário do login |
| 42px | input; botão secundário do login |
| 36px | aba do editor |
| 28–36px | botão em contexto denso |
| 28px | breadcrumb |
| 24px | status bar |
| 21px | linha de código |

Raios: 4–5px (badge mono), 6–7px (input pequeno, botão de ícone), 8px (botão,
input, card pequeno — `var(--radius-md)`), 10–12px (card, tabela —
`var(--radius-lg)`), 22px (tile de marca grande). Os tokens cobrem os três
degraus que a UI usa em volume (`--radius-sm` 4px, `--radius-md` 8px,
`--radius-lg` 12px, `--radius-full`); 6–7px e 22px são valores de contexto
único e ficam escritos onde são usados.

Sombras: `var(--shadow)` é a padrão (`0 1px 2px rgba(0,0,0,.4), 0 12px 32px
rgba(0,0,0,.45)`); `var(--shadow-lg)` é a do card de login
(`0 24px 60px rgba(0,0,0,.55)`).

Transições: 120–130ms para cor e borda; `bfade` .13s ease-out para dropdowns;
caret do terminal 1.05s step-end; pulso ao vivo `bpulse` 2.4s ease-in-out
infinite (opacidade 1 → .35); spinner `bspin` .7s linear. Toda animação
contínua para em `prefers-reduced-motion` — o elemento fica, só o movimento
sai (ver "Botão com `loading`").

Cores derivadas saem sempre de `color-mix(in srgb, <token> N%, transparent)` —
tipicamente 11–15% para fundo de chip e 34–45% para borda de chip. Nunca um
hex novo inventado para "a versão clara de".

## Marca — o monograma B

Haste vertical sólida + dois chevrons. De perto é a letra B; de longe lê-se
`>>` — agentes avançando em cadeia. O chevron inferior fica a **58% de
opacidade**, e isso é semântico: é o handoff ainda em execução.

SVG canônico (`viewBox="0 0 24 24"`, `fill:none`, `stroke-linecap` e
`stroke-linejoin: round`):

```html
<path d="M5.4 3.6v16.8" stroke-width="3.4"/>
<path d="M10.4 4.6l5.6 3.8-5.6 3.8" stroke-width="2.8"/>
<path d="M10.4 12l5.6 3.8-5.6 3.8" stroke-width="2.8" opacity=".58"/>
```

Aplicação padrão: tile `var(--accent)` com stroke `var(--on-accent)`, raio ≈
28% do lado (32px→9px, 40px→11px, 96px→22px). Tamanho mínimo 16px — e nesse
tamanho o chevron inferior sobe para `opacity:.7`, senão some.

Variantes permitidas: tile terracota; terracota sobre superfície; teal sobre
fundo escuro (estado ativo); monocromático. **Nunca** girar, esticar, contornar
ou aplicar gradiente. Respiro mínimo = a largura da haste (3.4 unidades da
grade de 24).

Wordmark: Space Grotesk 700, `letter-spacing:-.045em`.

## Botões (base)

- **primary**: bg `var(--accent)`, texto `var(--on-accent)`, border
  `var(--accent)`, radius 8px, padding `9px 16px`, `font-weight:600`,
  `font-size:13px` Archivo. Hover: bg/border `var(--accent-hover)`. Focus:
  outline 2px `var(--accent)` offset 2px. Disabled: bg `var(--surface-2)`,
  texto `var(--text-muted)`, opacity .6, `cursor:not-allowed`.

**Tamanho** (`size`, FASE 17a): o default é o botão denso acima, na faixa de
28–36px da tabela de alturas. `lg` é a **ação principal de uma tela inteira** —
`height: 44px`, `padding: 0 16px`, `font-size:14px`,
`letter-spacing:.01em` —, hoje o submit das quatro telas de auth. É `height`
fixa e não mais padding porque o rótulo troca em `loading` ("Entrar" →
"Autenticando…") e a caixa não pode mudar de altura quando o spinner entra.
`size` é independente de `fullWidth`: largura e altura respondem a perguntas
diferentes.
- **secondary**: bg `var(--surface-2)`, texto `var(--text-primary)`,
  border `var(--border)`. Hover: border `var(--border-strong)`. Disabled:
  bg transparent, opacity .5.
- **ghost**: bg transparent, texto `var(--text-secondary)`, sem border.
  Hover: bg `var(--surface-2)`, texto `var(--text-primary)`.

## AgentCard

Avatar geométrico (ícone SVG outline distinto por agente, não foto/letra)
40–44px, `border-radius:10px`, bg `color-mix(in srgb, <cor-do-status> 18%,
var(--surface-2))`, border `color-mix(in srgb, <cor> 40-50%, transparent)`.
Nome (Space Grotesk 600, 14-15px) + badge de status (pílula, `font-family:
IBM Plex Mono`, 10px, com dot 6px):
| status | cor | animação |
|---|---|---|
| trabalhando | `var(--success)` | `bpulse` (pulso, 1.4s infinite) |
| aguardando | `var(--warning)` | nenhuma |
| ocioso | `var(--text-muted)` | nenhuma |
| falhou | `var(--danger)` | nenhuma |

Subtítulo: papel/especialidade (12px, `var(--text-muted)`). Rodapé
separado por `border-top`: ícone de "model" (capacete/caixa) + nome do
modelo vinculado + provider (`claude-sonnet-4 · API` / `llama3.1:8b ·
Ollama`), 11px mono. No painel do time de agentes (tela Project), cada
card também tem um toggle de autonomia manual/auto (pill de 2 botões).

**Roster fixo dos 9 agentes** (CLAUDE.md): Psicólogo, Anamnese, Criativo,
Arquiteto, PO, Dev Backend, Dev Frontend, Infra, QA, SecOps — cada um com
uma cor de acento própria usada no avatar/nome ao longo de toda a UI
(consistente entre chat e overview): Psicólogo `var(--violet)` `#9C7BE0`,
Anamnese `var(--success)` `#37B3A4`, Criativo `var(--warning)` `#E0982F`,
Arquiteto `var(--accent)` `#D6633A`, PO `var(--violet)` `#9C7BE0`, Dev
Backend `var(--success)` `#37B3A4`, Dev Frontend `#5EBEB1`, Infra
`var(--warning)` `#E0982F`, QA `var(--danger)` `#E05A3E`, SecOps `#8AA6AE`.

## TokenMeter

Card `var(--surface-1)`, border `var(--border)`, radius 12px, padding
20px (variante compacta nos ProjectCards: menor, radius 8px, padding
10-12px, sem o texto de economia extra).
- Linha superior: `"{usado} / {limite} tokens"` (mono 12-13px, secondary)
  + percentual à direita (mono, bold, cor conforme threshold).
- Barra: altura 6-10px, bg `var(--surface-0)`/`var(--surface-2)`, radius
  full, preenchimento `linear-gradient(90deg, var(--success), var(--warning))`
  (a 100% some o `--danger` na composição real — ver variante "alerta"
  abaixo) — largura = percentual.
- **Thresholds de cor** (confirmados nos mockups Project/Settings):
  `< 70%` → verde (`var(--success)` domina, sem aviso); `70–89%` → aviso,
  cor do percentual e possivelmente do texto em `var(--warning)`;
  `>= 90%` → `var(--danger)`, ícone de alerta piscando (`balert`,
  `opacity 1↔.5`, 1.6s) e borda do card em
  `color-mix(in srgb, var(--danger) 45%, var(--border))`; nesse caso o
  gradiente da barra ganha um terceiro estágio pro vermelho
  (`success→warning→danger`) com marcadores verticais finos em 70%/90%.
  Rótulo textual no card de alerta: `"{pct}% do limite mensal"`.
- Marcadores 70/90/100 abaixo da barra (texto 9px mono, `text-muted`,
  posicionados via `left:70%/90%/100%`).
- Rodapé: custo do ciclo (`"R$ X · US$ Y"`, mono 15-16px bold) à esquerda,
  economia por compressão à direita (mono bold, `var(--success)`,
  `"−R$ X"`). Variante expandida (Design System base) ainda mostra um
  badge extra abaixo: `"{pct}% de tokens poupados este ciclo"` com ícone
  de seta-pra-cima, fundo `color-mix(var(--success) 12%)`.
- **Variante "ao vivo"** (topbar da sessão de chat): mais compacta (220px,
  padding 7-12px), com indicador `"ao vivo"` (dot pulsante verde) + texto
  `"falta {N}"` em `var(--warning)` à direita, sem os marcadores de
  threshold nem o rodapé de economia (só `"{usado}/{limite}"` +
  `"R$ custo"` numa linha compacta).

## EventItem / ActivityFeed

Linha: ícone 26x26px `border-radius:7px` colorido por tipo (`bg:
color-mix(<cor> 15-16%, transparent)`, `color:<cor>`), texto (13px,
`<b>{agente}</b> {ação}` com trechos técnicos em mono `text-secondary`),
tempo relativo à direita (11px mono, `text-muted`, `white-space:nowrap`).
Hover de linha: `background: var(--surface-2)`. Borda entre itens:
`border-top: 1px solid var(--border)`.
Cores por tipo de evento: commit → `text-secondary`; PR/pull request →
`var(--accent)`; hypothesis (psicólogo) → `var(--violet)`; session (encerramento
anormal) → `var(--danger)`; permission (concedida/negada) → `var(--success)`
(negada usa `var(--danger)` via um flag `bad` separado do tipo).
No feed da tela Project: filtro por agente (select) + chips de tipo
(pílulas clicáveis, selecionado = bg `var(--accent)`/texto `on-accent`).
Estado vazio: ícone de relógio + texto explicativo centralizado.

## ApprovalCard

Card `var(--surface-1)`, border `var(--border)` (ou
`color-mix(var(--danger) 32%, var(--border))` quando urgência = crítica),
radius 12px.
- Header: ícone por tipo de ação (diff→ícone "diff", terminal→ícone
  "terminal", PR→ícone "pr"), `<b>{agente}</b> {ação}` (ex.: "propõe
  alteração" / "quer executar comando" / "abriu pull request"), meta
  (modelo · contexto) à direita ou abaixo, badge de urgência opcional
  (fila de Aprovações: crítico/alta/normal, pílula com dot pulsante só no
  crítico).
- Corpo por variante:
  - **diff**: bloco `var(--code-bg)`, linhas com número (opacity .6),
    sinal `+`/`-` colorido (`var(--success)`/`var(--danger)`), fundo de
    linha `--diff-add`(`#0E2E24`)/`--diff-del`(`#331A16`) quando expandido;
    na fila de Aprovações é colapsável (header clicável com chevron que
    gira 90°, mostra nome do arquivo + contagem `+N −N`).
  - **comando/terminal**: uma linha mono `$ {comando}` sobre
    `var(--code-bg)`; no chat, o output real do comando some junto (bloco
    separado "terminal · output", com badge opcional `rtk −N%` quando
    houver compressão real).
  - **PR**: título (Space Grotesk 600), `{branch-origem} → {branch-destino}`
    (retângulos mono de raio 6 com borda `var(--border)`, não pílulas) +
    status, resumo (texto secundário).
- Ações (estado pendente): 3 botões lado a lado — **Aprovar** (bg
  `var(--success)`, texto branco), **Negar** (ghost com borda
  `color-mix(var(--danger) 45%)`, texto `var(--danger)`), **Sempre
  permitir** (secondary). Os dois primeiros esticam (`flex:1`) só na
  variante **chat**, onde a coluna é estreita; na **fila de Aprovações**
  têm largura de conteúdo, como no handoff. Abaixo, no chat: nota fixa
  (ícone de alerta + mono 11px, `text-muted`):
  `"'Sempre permitir' grava a regra em .brabo/permissions.json"`.
- Estado decidido: some os botões, mostra uma linha com dot colorido +
  texto (`"Aprovado · comando em execução"` verde / `"Negado"` vermelho /
  `"Sempre permitido · gravado em permissions.json"` accent).
- Fila de Aprovações também tem seleção em lote: checkbox por card (canto
  superior esquerdo do header) + barra de ação no CABEÇALHO DA SEÇÃO
  quando há seleção (`"{N} selecionadas"` + "Aprovar selecionados" +
  "Limpar"). No cabeçalho, e não numa faixa própria acima da fila: a faixa
  empurrava a lista 44px para baixo no primeiro clique de cada seleção.

**Estrutura do card (handoff, seção 6):** o card RECORTA
(`overflow: hidden`) e não tem padding próprio — cada região traz o seu e a
divisória: cabeçalho 14×16 com borda embaixo, corpo colado nas bordas
(terminal e diff sobre `var(--code-bg)`, PR sobre a superfície do card),
ações 12×16 com borda em cima. A faixa que abre o diff fica sobre
`var(--surface-2)`.

## ModelPicker

Dropdown/lista (largura ~300-440px conforme o contexto: standalone no
Design System, inline nas linhas da tabela de Configurações, ou dropdown
no topbar da sessão), fundo `var(--surface-1)`, border `var(--border-strong)`
quando aberto, `box-shadow: var(--shadow)`.
- Cabeçalho de grupo (sticky): `var(--surface-2)`, mono 9-10px uppercase
  `letter-spacing:.08em`, `text-muted` — dois grupos fixos: **"Local ·
  Ollama"** e **"Cloud · por provedor"** (ou "Cloud" sozinho na variante
  base).
- Cada opção: radio custom (círculo 13-16px, ring `var(--border-strong)`
  ou `var(--accent)` quando selecionado, dot interno preenchido só quando
  selecionado) + nome do modelo (mono 12-13px) + (cloud) `· {provider}`
  em `text-muted` + badge de custo à direita (`"grátis"` em
  `var(--success)` pros locais; `"R$ X · US$ Y"` em `text-secondary`/
  `text-muted` pros cloud), fundo do botão inteiro realçado
  (`color-mix(var(--accent) 10%, transparent)`) quando é o selecionado
  atual. Hover: `background: var(--surface-2)`.
- Trigger (fechado): botão com ícone de modelo + nome atual + (variante
  topbar) chevron; no contexto de tabela (Configurações), o trigger some
  a origem do binding (badge separado, ver Settings abaixo) e mostra só
  modelo+provider abreviado+chevron.

## NotificationBell (não estava no Design System base — extraído da tela
App)

Botão 38x38px, radius 8px, `var(--surface-1)`/`var(--border)`, badge de
contagem (pílula `var(--accent)`, mono 9px, `border: 2px solid
var(--surface-0)` pra "recortar" do fundo) no canto superior direito.
Dropdown (380px, `max-height:70vh` com scroll): header sticky "Notificações"
+ link "marcar lidas" (accent). Agrupado por projeto: cabeçalho de grupo
(`var(--surface-2)`, dot do projeto + nome + contagem de eventos), lista de
eventos (mesmo visual do EventItem, ícone+texto+tempo).

## Cards genéricos (Design System base — Cards / Tabela densa / Inputs /
Tabs / Toasts / Modal)

- **ProjectCard** (dashboard): header (ícone do provider 34px + nome
  Space Grotesk 600 15px + provider label mono 11px muted + badge de
  não-lidos opcional), fileira de avatares de agente sobrepostos
  (`margin-left:-6px`, `box-shadow: 0 0 0 2px var(--surface-1)` pra
  separar), `TokenMeter` compacto, rodapé com dot de atividade + texto
  (última atividade, 12px, truncado).
- **Tabela densa** (permissões/membros/modelos/matriz): grid via
  `display:grid;grid-template-columns:...` (não `<table>`), header
  `var(--surface-2)` mono 10px uppercase, linhas com `border-top` +
  hover `var(--surface-1)`, colunas separadas por `border-left`.
- **Inputs/selects**: fundo `var(--surface-0)`/`var(--surface-1)`, border
  `var(--border)`, radius 8px, padding `8-11px 12-13px`. Focus:
  `border-color: var(--accent)` + `box-shadow: 0 0 0 3px color-mix(in srgb,
  var(--accent) 22%, transparent)`. Select custom com chevron SVG
  posicionado absoluto (nunca a seta nativa do browser — `appearance:none`).
- **Tabs**: sem fundo, `border-bottom:2px solid transparent`, ativo =
  `border-color: var(--accent)` + `color: var(--text-primary)` +
  `font-weight:600`; inativo = `color: var(--text-muted)`,
  `font-weight:500`. Badge de contagem opcional ao lado do label (pílula
  accent, mesmo padrão de badge de não-lidos).
- **Toast**: fixo `bottom:24px;right:24px`, `border-left:3px solid <cor>`,
  dot colorido, título (Space Grotesk 600 13px) + mensagem (mono 11px
  secondary), botão de fechar (X ghost). Animação de entrada `btoast`
  (sobe 8px + fade).
- **Modal**: overlay `rgba(3,10,14,.62-.66)` + `backdrop-filter: blur(2-3px)`,
  card centralizado `var(--surface-1)`, `border: 1px solid
  var(--border-strong)`, radius 12-14px, `box-shadow: var(--shadow)`,
  animação de entrada (fade+scale, `bpop`/`btoast`). Header com ícone +
  título + botão fechar (X). Clique no overlay fecha; clique no card
  propaga `stopPropagation` (não fecha).

## Wizard "Novo projeto" (tela App, modal)

4 passos com stepper (círculos numerados conectados por linha,
preenchido/atual/pendente com cores diferentes — accent no atual e nos já
completos, `surface-2`/`text-muted` no pendente):
1. **Provider**: grid 2x2 de opções (GitHub/GitLab/Bitbucket/Local),
   ícone + label + descrição, seleção = borda+fundo accent.
2. **Nome**: input de texto + preview do slug calculado
   (`repo: brabo/{slug}`, mono, em bloco `var(--code-bg)`).
3. **Branches** *(cosmético — sem contraparte no backend, ver plano)*:
   escolha de política (Gitflow/Trunk-based/Personalizada, radio custom)
   + preview da lista de branches resultante (pílulas mono).
4. **Agentes** *(cosmético — sem contraparte no backend)*: lista de
   agentes com checkbox, contador de selecionados.
Rodapé: botão Voltar (condicional) + `"passo N de 4"` + botão
Continuar/Criar projeto (opacity reduzida quando o passo não pode
avançar).

## Alert (extraído do mockup de login — 2026-07-30)

Bloco de aviso **no fluxo** da página, não flutuante. Não é `Toast`: aquele
é transiente e vive fixo na viewport; este ocupa espaço e fica.

Anatomia comum: `display:flex; align-items:flex-start; gap:10px;
padding:10px 12px; radius 8px`, ícone 15px com `flex-shrink:0` e
`margin-top:2px` (alinha com a primeira linha do texto, não com o topo da
caixa), texto 12.5px `line-height:1.5` com `text-wrap:pretty`. `<strong>`
dentro do texto puxa `var(--text-primary)` + `font-weight:600` — é o nome
da ação que a pessoa precisa procurar.

Duas formas, e a diferença é de posição:

- **dentro de um card** (erro de formulário): fundo e borda tingidos pelo
  tom — `color-mix(in srgb, var(--danger) 10%, transparent)` e
  `color-mix(..., 40%, transparent)`, sem borda lateral. Precisa se separar
  do card por cor. Texto em `var(--text-primary)`: é a informação da hora.
- **fora do card** (aviso de contexto): fundo `var(--surface-1)`, borda
  `1px var(--border)` e `border-left: 2px solid <cor do tom>`. Já está
  sobre o fundo da página, então só precisa de um acento.

4 tons — `danger` / `warning` / `success` / `accent`. O ícone default vem
do tom: círculo com `!` no `danger` (**falha**), triângulo com `!` no
`warning`/`accent` (**atenção**), check no `success`. Dois símbolos para duas
coisas diferentes; com um só, seria preciso ler o texto para saber qual é.

**O papel de acessibilidade NÃO é derivado do tom** — é escolhido por quem
usa. `role="alert"` é live region assertiva (interrompe o leitor de tela) e
serve para o resultado de uma ação que a pessoa acabou de disparar;
`role="status"` é polida e serve para confirmação; o default é papel nenhum,
para texto que já estava na tela quando ela abriu. Ver ADR 0036.

## Botão com `loading`

Estende o `primary`/`secondary` já especificado. Spinner 15px à esquerda do
label, `gap:9px`: `border: 2px solid color-mix(in srgb, var(--on-accent)
35%, transparent)`, `border-top-color: var(--on-accent)`, `radius 50%`,
`animation: bspin .7s linear infinite`. O label troca (`Entrar` →
`Autenticando…`).

Três obrigações: o botão fica `disabled` (é o que impede duplo submit virar
duas requisições); ganha `aria-busy="true"` (sem isso, quem usa leitor de
tela só percebe que o botão desabilitou); e o spinner é `aria-hidden`, para
não entrar no nome acessível. Em `prefers-reduced-motion` a animação para —
o elemento **fica**, porque removê-lo mudaria o layout do botão.

## Campo preenchido (segunda anatomia de input)

O `Inputs/selects` acima segue valendo como default. Esta é a variante do
mockup de login, e é **opt-in**: as telas fora de auth continuam no default.

`background: var(--code-bg)`, `height: 42px`, `padding: 0 13px`,
`font-size: 14px`. As três coisas vêm da mesma especificação e viajam
juntas — metade dela dá um campo que não existe em lugar nenhum.

O campo é **afundado**, como no handoff. Foi `var(--surface-2)` (campo
**elevado**) até a FASE 17a, divergência que o ADR 0036 registrara: sobre um
card `var(--surface-1)`, o fundo default do campo é o MESMO do card, separados
só por 1px de borda. O problema era real e continua valendo para as telas fora
de auth; afundar o resolve igual, segue a referência versionada e ainda melhora
o contraste.

**Senha**: `var(--font-mono)` 13.5px `letter-spacing: .02em` (mono a 14px ao
lado de Archivo a 14px lê como corpo maior). Placeholder em
`var(--text-secondary)`, não `var(--text-muted)`: sobre `--code-bg` o muted
passaria (5.65:1), mas placeholder é texto de leitura e a razão de ele estar
mais presente que no handoff não mudou.

**Botão de revelar**: 32×32 absoluto, `right: 5px`, centrado vertical,
radius 4px, `color: var(--text-muted)`; hover `var(--text-secondary)` +
`background: var(--surface-2)`. O campo abre `padding-right: 44px`. Rótulo
acessível diz a **ação** ("Mostrar senha"/"Esconder senha") e `aria-pressed`
diz o estado — rótulo de estado deixaria a pessoa sem saber o que o botão faz.

**Ação no rótulo** (o "Esqueci minha senha" ao lado de "Senha"): linha flex
com `justify-content: space-between; align-items: baseline`. A ação é
**irmã** do `<label>`, nunca filha — clique em qualquer lugar de um
`<label>` ativa o campo associado.

## Foco visível (regra geral, corrigida na Fase 7)

`:focus-visible`, nunca `:focus`: este acende ao clicar com o mouse, o que
não é o que a indicação de foco resolve.

Campo: `border-color: var(--accent)` + `box-shadow: 0 0 0 3px color-mix(in
srgb, var(--accent) 22%, transparent)` **mais** `outline: 2px solid
transparent`. O outline transparente não é enfeite: em `forced-colors`
(alto contraste do sistema) o `box-shadow` é descartado, e sem ele o campo
focado fica sem indicador NENHUM. Um `@media (forced-colors: active)` pinta
o outline com `Highlight`.

Botão e link: `outline: 2px solid var(--accent); outline-offset: 2px`.
Link de texto sobre `--surface-1` usa `var(--accent-hover)` em repouso —
`var(--accent)` dá 3.88:1 e reprova o AA (ADR 0036).

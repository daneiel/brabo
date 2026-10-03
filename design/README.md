# design/

Design system do Brabo — fidelidade estrita exigida na UI (ver `CLAUDE.md`).

- **`tokens.css`** — cores (paleta + tokens semânticos dark/light),
  tipografia (Space Grotesk/Archivo/IBM Plex Mono, mais a escala `--fs-*`),
  espaçamento, radius e as métricas do shell (`--sidebar-w`, `--header-h`,
  `--tabs-h`). Extraído do projeto claude.ai/design ["Brabo Design
  System"](https://claude.ai/design/p/1c960ca8-5e00-4558-8ced-80dfbdf01027?file=Brabo+Design+System.dc.html)
  em 2026-07-23 e reconciliado com o handoff versionado em 2026-08-08.
  É consumido diretamente por `apps/web/src/index.css`.
  Dark é o tema primário; `[data-theme="light"]` no `<html>` troca para
  o tema claro — e quem escreve esse atributo é
  `apps/web/public/theme-boot.js` (ADR 0074, RN-182). Até ele existir o tema
  claro estava aqui e era **inalcançável**: nenhum caminho do produto definia
  `data-theme`.

  Dois grupos de nome são **alias**, não renomeação: `--font-display` aponta
  para `--font-heading`, `--shadow-modal` para `--shadow-lg`, e
  `--r-md`/`--r-lg`/`--r-pill` para os `--radius-*` que já existiam. São os
  nomes do handoff; trocar os antigos seria um rename cego por sinônimo em
  dezenas de arquivos. Atenção a um degrau que **não** coincide: `--r-sm` é
  7px e `--radius-sm` é 4px.
- **`COMPONENTS.md`** — catálogo dos componentes (base: botões, inputs,
  tabs, toasts, modal, tabela densa, cards; de produto: AgentCard,
  TokenMeter, EventItem, ApprovalCard, ModelPicker, NotificationBell),
  extraído do mesmo projeto (arquivo `Brabo Design System.dc.html` +
  os 5 arquivos de tela) em 2026-07-23.
- **`SCREENS.md`** — composição de cada tela (shell+dashboard, projeto
  com tabs, sessão/chat, aprovações, configurações), mesma fonte.

`COMPONENTS.md`/`SCREENS.md` são a tradução curada usada como base pra
implementação real em React/TSX em `apps/web`.

**Tintas semânticas** (AT-285). Fundo e borda tingidos por um tom de estado
não se escrevem mais com `color-mix()` no módulo: a escala é UMA e mora no
`tokens.css`, no fim de cada bloco de tema —

| token | o que é | mistura |
|---|---|---|
| `--<tom>-soft` | fundo tingido (badge, item ativo, alerta) | tom a `--tint-soft` (12%) sobre `transparent` |
| `--<tom>-line` | borda tingida | tom a `--tint-line` (40%) sobre `transparent` |
| `--<tom>-panel` / `--<tom>-panel-border` | faixa de aviso opaca | tom a `--tint-panel` (8%) sobre `--surface-1`; borda a 40% sobre `--border` |
| `--focus-ring` / `--focus-ring-inset` / `--danger-ring` | anel de foco | acento a 22% / 45%; perigo a 22% |

`<tom>` é `accent`, `success`, `warning` ou `danger` (`violet` tem só `-soft` e
`-line`). Misturar com `transparent` é o que faz a tinta funcionar sobre
QUALQUER base — ela não carrega o matiz da superfície de baixo, que é o que
permite a paleta neutra trocar os fundos sem revisar módulo por módulo. Cor
DINÂMICA (`--agent-color`, `--status-color`…) continua em `color-mix()`, mas
com a porcentagem-token: `color-mix(in srgb, var(--agent-color)
var(--tint-soft), transparent)`. `apps/web/src/design-tintas.test.ts` reprova
mistura de tom fixo com porcentagem literal num módulo, tinta referenciada que
o `tokens.css` não declara, e tinta do `:root` que o tema claro não redeclara.
A consolidação arredondou vizinhos: os fundos de 10–18% viraram 12% e as
bordas de 30–50% viraram 40%.

**Escala** (AT-288). Fonte, espaço e raio saem dos degraus do `tokens.css`:
nenhum módulo tem meio-degrau de fonte (10,5/11,5/12,5 px — o 12,5 do handoff é
o `--fs-mono`), os módulos da Sessão, do Shell e do trilho escrevem pelo token
todo tamanho e espaço que tem degrau, e raio que coincide com um degrau passa
pelo token em qualquer módulo. As duas famílias de raio CONVIVEM como alias
declarado: `--r-md`/`--r-lg`/`--r-pill` apontam para `--radius-md`/`-lg`/`-full`,
e `--r-sm` (7px, botão de ícone) **não** é `--radius-sm` (4px) —
`apps/web/src/design-escala.test.ts` fixa as duas coisas. Ficam de fora, por
não terem degrau, os raios de 6, 9, 10 e 11px e as fontes de 14 e 17px.

Toda implementação de UI deve referenciar sempre os tokens semânticos
(`var(--surface-*)`, `var(--text-*)`, `var(--accent)`, `var(--violet)`
etc.) — nunca a paleta bruta nem valores de cor/espaçamento inventados.

**Padrões de tela** (AT-322, AT-327). O que a auditoria visual de 30/09 achou
em várias formas tem UMA agora, em `apps/web/src/components/ui/`:

| padrão | componente | regra |
|---|---|---|
| controle segmentado ("qual destes") | `SegmentedControl` | grupo rotulado de `Chip`s com `aria-pressed`, um ligado por vez — filtro de lista OU troca de painel; nunca `role="tab"` sem `tabpanel` |
| estado vazio | `EmptyState` | caixa tracejada centralizada, frase em `--text-secondary`, ícone e CTA opcionais; a FRASE é de quem chama (vazio por filtro ≠ por ausência) e erro/carregando seguem separados (RN-088) |
| CTA de criar | `Button` + `PlusIcon` | ícone + verbo ("Nova ideação"), nunca o caractere "+" no texto |
| botão desabilitado | `Button` | `--text-muted` sobre `--surface-2` com contorno `--border-strong`, SEM `opacity` — o par é medido em `design-contraste.test.ts` nos dois temas |
| decisão pedida | `ApprovalCard` | uma variante só nas quatro superfícies (fio, aba Aprovações, "precisa de você", pendências de outras sessões): mesmos botões com largura natural, mesmas notas em corpo de 12px, código da frase em mono sem aspas; a largura é do CONTÊINER |

Aba do projeto começa no topo, sem margem de seção antes do título: `.arch`
(`ProjectOverviewTab.module.css`) é de seção que vem DEPOIS de outra.

## `design_handoff_brabo/` — o handoff, versionado

Desde 2026-08-08 (FASE 16) o handoff de design vive **no repositório**, na
raiz: `README.md` com a especificação completa e oito `.dc.html` de alta
fidelidade em `designs/`. Antes, o detalhe visual não coberto por
`COMPONENTS.md`/`SCREENS.md` só existia atrás do `DesignSync(get_file)` — um
serviço externo. Agora a referência tem hash e histórico como o resto.

Três coisas que o handoff estabelece sobre si e valem como regra aqui:

1. Os `.dc.html` são **referência, não código para copiar**. Estilo inline é
   construção do protótipo; a implementação usa os padrões do `apps/web`.
2. `designs/support.js` é o runtime do protótipo — **não portar**.
3. Nenhum asset binário. Todo ícone é SVG inline, e o único asset de marca é o
   monograma B, que é componente e nunca imagem rasterizada.

**A divergência deliberada:** o handoff pede o `<link>` do Google
Fonts. As três famílias continuam **auto-hospedadas** (`@font-face` em
`apps/web/src/index.css` sobre os `.woff2` de `public/fonts/`). Não é
preferência — a CSP da imagem do nginx é `style-src 'self'; font-src 'self'
data:`, que bloqueia a folha e os arquivos; seguir o handoff nesse item
reintroduz exatamente a falha que o ADR 0036 fechou, e o sintoma é a tipografia
inteira caindo em fonte de sistema. As famílias, os pesos e as escalas do
handoff valem; a forma de carregá-las, não.

A mesma régua se aplicou duas vezes mais, no ADR 0074. O handoff manda aplicar
`data-theme` por **script inline no `<head>`** — inline é bloqueado pelo
`script-src 'self'` da imagem; o script existe e é um **arquivo**
(`apps/web/public/theme-boot.js`). E cinco dos oito valores `--syn-*` do
handoff reprovam 4,5:1 contra o próprio `--code-bg` dele; valem os números
medidos. Em todos os casos a intenção do handoff é seguida e o mecanismo (ou o
número) que quebra o produto, não.

## As duas validações da UI

Fidelidade ao desenho é conferida no olho. Duas classes de defeito, porém,
foram para o automático porque escapam de qualquer revisão visual — quem
escreveu já sabe onde olhar, e o monitor de quem escreveu é sempre o melhor.

**Contraste** é aritmética e virou teste:
`apps/web/src/lib/contraste.test.ts` lê ESTE `tokens.css`, resolve os `var()`
até a cor literal e mede a razão WCAG dos pares que a interface usa — **nos
dois temas** desde o ADR 0074 (RN-184). O Shimmer (ADR 0210) entra pelo pior
ponto do brilho, a cor-base `--text-secondary` sobre `--surface-0/1/2`: no
escuro 7,58/7,17/6,62:1, no claro 7,73/7,41/7,03:1.

**A paleta é neutra desde o ADR 0181 (RN-640).** O escuro deixou de ser
azul-petróleo e é preto neutro (`--surface-0/1/2` `#0d0d0f/#141417/#1c1c21`)
com o acento terracota **suave** (`#c8744f`); o claro é o neutro da mesma
família (`#ffffff/#fafafa/#f4f4f5`, acento `#a4502c`). As superfícies, o texto
secundário e as bordas vêm da escala bruta `--neutro-*`; a identidade terracota
ficou no acento, e o teste confere que o matiz dele continua na faixa
terracota nos dois temas. Os valores finais saíram da **medição**, não do
rascunho: onde o rascunho reprovava (`--text-muted` `#71717a` nos dois temas,
`--on-accent` claro sobre o acento do escuro), o número foi ajustado até o piso
passar — os números de antes e depois estão no ADR 0181.

**Não há mais dívida de contraste.** Do ADR 0074 ao 0181 o escuro carregou
cinco pares abaixo de 4,5:1, travados por número:

| par | razão até o ADR 0181 | hoje (escuro / claro) |
|---|---|---|
| `--text-muted` sobre `--surface-1` | 3,89:1 | 5,10 / 5,21 |
| `--text-muted` sobre `--surface-2` | 3,10:1 | 4,70 / 4,94 |
| `--accent` sobre `--surface-1` | 3,88:1 | 5,31 / 5,35 |
| `--danger` sobre `--surface-1` | 3,88:1 | 4,96 / 6,11 |
| `--success` sobre `--surface-2` | 4,41:1 | 6,69 / 4,85 |

Os cinco são **piso** agora, nos dois temas: a próxima mudança de paleta que os
devolver para baixo reprova em vez de ser registrada. Foi-se junto a "exceção
conhecida" do botão primário (`--on-accent` sobre `--accent`, 3,20:1 no
escuro): o `--on-accent` do escuro é o preto neutro, 5,61:1. E dois
consumidores que contornavam a dívida foram revistos — `.link` (auth) voltou
ao `--accent` do mock; `.hint` (Input) ficou no `--text-secondary`, agora por
hierarquia.

O mesmo teste guarda a **paridade entre os dois temas**: todo token semântico
de cor declarado no `:root` precisa ser redeclarado em `[data-theme="light"]`.
A lista é derivada do arquivo, não escrita à mão — token novo entra sozinho na
verificação. O defeito que isso pega não é "a cor sumiu": é a cor calibrada
para o escuro **vazando** para o tema claro, que aparece longe do commit que a
causou.

A **paleta de sintaxe** tem os oito papéis do handoff com o prefixo
`--syntax-*` (RN-185), cada um com valor próprio por tema e todos medidos a
4,5:1 contra `--code-bg` nos dois (recalculados no ADR 0181 contra os
`--code-bg` neutros). Cinco dos oito valores que o handoff
especifica foram **recusados por medição** (o ADR 0074 diz qual e
por quanto; o comentário do arquivo, os números atuais) — onde o handoff
reprova, vale o número medido.

`--violet` (agentes/IA) entrou na FASE 16 e é medido como elemento de
interface (3:1) nas três superfícies e como texto (4,5:1) sobre `--code-bg`,
onde ele é número e decorator no realce. No ADR 0181 ele foi dessaturado junto
com o resto (`#9d8ad6` no escuro, `#6a50b8` no claro). As três cores de agente
sem semântico — `--agent-leve`, `--agent-frontend`, `--agent-secops` — viraram
token por tema no mesmo ADR (eram hex soltos em `lib/agents.ts`) e são medidas
pela mesma régua do `--violet`.

**Cor que precisa sair do CSS** (Mermaid, xterm, o canvas do minimapa) lê o
token do tema ativo e, sem ele, cai em `apps/web/src/lib/tokens-padrao.ts` —
uma cópia do `:root` que `tokens-padrao.test.ts` confere contra este arquivo.
E `apps/web/src/design-tokens-existentes.test.ts` reprova qualquer
`var(--x)` de módulo CSS que ninguém declara (foi assim que `--surface-3` e
`--radius-pill`, usados e nunca definidos, apareceram).

**Layout** depende de medida real — largura de fonte, quebra de linha, posição
calculada — e nenhum ambiente de teste do repositório faz layout (jsdom não
mede nada). Então roda no navegador, contra a aplicação de pé:
`scripts/dev/validacao-visual.js`, colado no console ou executado pelo agente.
Ele acusa quatro coisas:

1. **texto cortado** — conteúdo maior que a caixa, com overflow não rolável;
2. **fora da viewport** — menu, dropdown ou tooltip cujo retângulo sai da tela;
3. **recortado por ancestral** — o clássico dropdown dentro de um container com
   `overflow: hidden`, que existe, tem tamanho e some;
4. **alvo pequeno** — botão ou link abaixo de 24px (WCAG 2.2 AA).

Sem dependência nova de propósito: um verificador que exige instalar runtime
não é rodado. A saída é JSON, para virar achado — nunca correção automática.

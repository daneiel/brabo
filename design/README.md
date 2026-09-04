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

Toda implementação de UI deve referenciar sempre os tokens semânticos
(`var(--surface-*)`, `var(--text-*)`, `var(--accent)`, `var(--violet)`
etc.) — nunca a paleta bruta nem valores de cor/espaçamento inventados.

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
dois temas** desde o ADR 0074 (RN-184). Ele também trava a **dívida
conhecida** — pares em uso que não atingem 4,5:1 para texto normal, medidos e
registrados um a um. Não estão escondidos nem quebrando o CI: mudar a paleta é
decisão do dono do design system, e o teste avisa se o número piorar (ou
melhorar).

A dívida é do **tema escuro**, e é só dela:

| par | razão | serve como |
|---|---|---|
| `--text-muted` sobre `--surface-1` | 3,89:1 | elemento de interface, não texto corrido |
| `--text-muted` sobre `--surface-2` | 3,10:1 | idem — é o cabeçalho de tabela |
| `--accent` / `--danger` sobre `--surface-1` | 3,88:1 | realce e erro dentro de card |
| `--success` sobre `--surface-2` | 4,41:1 | a um passo do piso |

No **tema claro** esses cinco pares passam os 4,5:1, e não por sorte: o ADR
0074 calibrou os acentos do claro contra `--code-bg`, que é a superfície mais
exigente do tema (papel, a um passo dos fundos), então quem fecha lá fecha em
todo o resto. Seis tokens mudaram de valor no caminho — `--accent`,
`--accent-hover`, `--warning`, `--success`, `--violet` e `--text-muted` — e o
tema escuro não mudou nenhum. O claro ficou, por isso, um degrau mais escuro
que os hex do handoff: é a mesma troca das fontes, o handoff estabelece a
intenção e a medição estabelece o número.

O mesmo teste guarda a **paridade entre os dois temas**: todo token semântico
de cor declarado no `:root` precisa ser redeclarado em `[data-theme="light"]`.
A lista é derivada do arquivo, não escrita à mão — token novo entra sozinho na
verificação. O defeito que isso pega não é "a cor sumiu": é a cor calibrada
para o escuro **vazando** para o tema claro, que aparece longe do commit que a
causou.

A **paleta de sintaxe** tem os oito papéis do handoff com o prefixo
`--syntax-*` (RN-185), cada um com valor próprio por tema e todos medidos a
4,5:1 contra `--code-bg` nos dois. Cinco dos oito valores que o handoff
especifica foram **recusados por medição** (o comentário do arquivo diz qual e
por quanto) — onde o handoff reprova, vale o número medido.

`--violet` (agentes/IA) entrou na FASE 16 e está medido: 5,31:1 sobre
`--surface-0`, 4,30:1 sobre `--surface-1` e 3,42:1 sobre `--surface-2` —
cumpre o piso de elemento de interface nos três, que é o papel dele (dot de
status, badge, avatar de agente). Sobre `--code-bg` dá 5,65:1, e ali ele é
texto de verdade (número e decorator no realce de sintaxe), então responde
pelo piso de texto normal. No tema claro ele é `#6b4fb0`, o valor que o
handoff passou a especificar, e mede 4,95:1 sobre `--code-bg`.

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

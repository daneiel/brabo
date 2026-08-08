# design/

Design system do Brabo — fidelidade estrita exigida na UI (ver `CLAUDE.md`).

- **`tokens.css`** — cores (paleta + tokens semânticos dark/light),
  tipografia (Space Grotesk/Archivo/IBM Plex Mono), espaçamento e
  radius. Extraído do projeto claude.ai/design ["Brabo Design
  System"](https://claude.ai/design/p/1c960ca8-5e00-4558-8ced-80dfbdf01027?file=Brabo+Design+System.dc.html)
  em 2026-07-23 e reconciliado com o handoff versionado em 2026-08-08.
  É consumido diretamente por `apps/web/src/index.css`.
  Dark é o tema primário; `[data-theme="light"]` no `<html>` troca para
  o tema claro.
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

**A divergência deliberada, e a única:** o handoff pede o `<link>` do Google
Fonts. As três famílias continuam **auto-hospedadas** (`@font-face` em
`apps/web/src/index.css` sobre os `.woff2` de `public/fonts/`). Não é
preferência — a CSP da imagem do nginx é `style-src 'self'; font-src 'self'
data:`, que bloqueia a folha e os arquivos; seguir o handoff nesse item
reintroduz exatamente a falha que o ADR 0036 fechou, e o sintoma é a tipografia
inteira caindo em fonte de sistema. As famílias, os pesos e as escalas do
handoff valem; a forma de carregá-las, não.

## As duas validações da UI

Fidelidade ao desenho é conferida no olho. Duas classes de defeito, porém,
foram para o automático porque escapam de qualquer revisão visual — quem
escreveu já sabe onde olhar, e o monitor de quem escreveu é sempre o melhor.

**Contraste** é aritmética e virou teste:
`apps/web/src/lib/contraste.test.ts` lê ESTE `tokens.css`, resolve os `var()`
até a cor literal e mede a razão WCAG dos pares que a interface usa. Ele
também trava a **dívida conhecida** — pares em uso que não atingem 4,5:1 para
texto normal, medidos e registrados um a um. Não estão escondidos nem
quebrando o CI: mudar a paleta é decisão do dono do design system, e o teste
avisa se o número piorar (ou melhorar).

| par | razão | serve como |
|---|---|---|
| `--text-muted` sobre `--surface-1` | 3,89:1 | elemento de interface, não texto corrido |
| `--text-muted` sobre `--surface-2` | 3,10:1 | idem — é o cabeçalho de tabela |
| `--accent` / `--danger` sobre `--surface-1` | 3,88:1 | realce e erro dentro de card |
| `--success` sobre `--surface-2` | 4,41:1 | a um passo do piso |

O mesmo teste guarda a **paridade entre os dois temas**: todo token semântico
de cor declarado no `:root` precisa ser redeclarado em `[data-theme="light"]`.
A lista é derivada do arquivo, não escrita à mão — token novo entra sozinho na
verificação. O defeito que isso pega não é "a cor sumiu": é a cor calibrada
para o escuro **vazando** para o tema claro, que aparece longe do commit que a
causou.

`--violet` (agentes/IA) entrou na FASE 16 e está medido: 5,31:1 sobre
`--surface-0`, 4,30:1 sobre `--surface-1` e 3,42:1 sobre `--surface-2` —
cumpre o piso de elemento de interface nos três, que é o papel dele (dot de
status, badge, avatar de agente). Sobre `--code-bg` dá 5,65:1, e ali ele é
texto de verdade (número e decorator no realce de sintaxe), então responde
pelo piso de texto normal. No tema claro o valor é derivado (`#7b56c9`, 4,50:1
sobre `--surface-0`), porque o handoff só especifica o escuro.

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

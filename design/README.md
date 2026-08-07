# design/

Design system do Brabo — fidelidade estrita exigida na UI (ver `CLAUDE.md`).

- **`tokens.css`** — cores (paleta + tokens semânticos dark/light),
  tipografia (Space Grotesk/Archivo/IBM Plex Mono), espaçamento e
  radius. Extraído do projeto claude.ai/design ["Brabo Design
  System"](https://claude.ai/design/p/1c960ca8-5e00-4558-8ced-80dfbdf01027?file=Brabo+Design+System.dc.html)
  em 2026-07-23. É consumido diretamente por `apps/web/src/index.css`.
  Dark é o tema primário; `[data-theme="light"]` no `<html>` troca para
  o tema claro.
- **`COMPONENTS.md`** — catálogo dos componentes (base: botões, inputs,
  tabs, toasts, modal, tabela densa, cards; de produto: AgentCard,
  TokenMeter, EventItem, ApprovalCard, ModelPicker, NotificationBell),
  extraído do mesmo projeto (arquivo `Brabo Design System.dc.html` +
  os 5 arquivos de tela) em 2026-07-23.
- **`SCREENS.md`** — composição de cada tela (shell+dashboard, projeto
  com tabs, sessão/chat, aprovações, configurações), mesma fonte.

Os `.dc.html` originais usam a sintaxe de template do canvas do
claude.ai/design (`sc-for`/`sc-if`/`{{ }}`) — não são código executável,
por isso não foram copiados verbatim pro repo; `COMPONENTS.md`/`SCREENS.md`
são a tradução curada usada como base pra implementação real em
React/TSX em `apps/web`. Pra reconferir algum detalhe visual não coberto
por esses dois arquivos, o projeto original permanece acessível via
`DesignSync(get_file)`.

Toda implementação de UI deve referenciar sempre os tokens semânticos
(`var(--surface-*)`, `var(--text-*)`, `var(--accent)` etc.) — nunca a
paleta bruta nem valores de cor/espaçamento inventados.

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

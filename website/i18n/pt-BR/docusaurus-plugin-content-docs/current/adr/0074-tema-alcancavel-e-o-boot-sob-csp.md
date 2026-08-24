# 0074 — Tema alcançável, e o boot sob CSP

**Status:** aceito · 2026-08-14

## Contexto

O `design/tokens.css` tem dois temas desde o primeiro dia. O escuro é o
primário e está em `:root`; o claro vive em `[data-theme='light']`, é medido
por teste de paridade (todo token semântico de cor precisa ser redeclarado
nele) e é citado no `design/README.md` como se fosse uma tela do produto.

Ele nunca foi uma. **Nada em `apps/web` escrevia `data-theme` em lugar
nenhum** — nem o `index.html`, nem o `main.tsx`, nem componente algum. O
seletor existia, os valores existiam, e o único jeito de ver o tema claro era
digitar o atributo no DevTools. O teste `apps/web/test/design-contraste.test.ts`
sabia disso e dizia com todas as letras: *"`[data-theme='light']` existe nos
tokens e **nada o define** em nenhum lugar da app"* — e ia além, afirmando por
`expect` que **três pares reprovavam** o AA no claro, deliberadamente, "como
registro do que se herda, não como garantia do que se renderiza".

Do outro lado, `apps/web/src/lib/contraste.test.ts` media a paleta de sintaxe
só no tema escuro, e o comentário dizia por quê: `--accent`, `--warning` e
`--success` contra o `--code-bg` claro já ficavam abaixo de 4,5:1. Enquanto o
claro fosse inalcançável, os dois arquivos estavam certos — medir uma tela que
ninguém pode abrir é medir uma intenção.

O que muda essa conta é o programa 28 pedir o botão de tema. Ligado o botão,
metade da superfície visível do produto passa a ser uma tela que nunca foi
medida, e as três reprovações registradas deixam de ser dívida documentada
para virar defeito servido.

Há ainda um detalhe de entrega que não é acessório. O handoff
(`design_handoff_brabo/tokens.css`) instrui: *"aplique o atributo o mais cedo
possível (script inline no `<head>`)"*. A imagem de produção do web serve sob
`script-src 'self'` (`docker/web/nginx.conf`), sem `'unsafe-inline'` e sem
nonce. Um `<script>` inline no head funcionaria em `pnpm dev:web` e seria
**bloqueado na imagem publicada** — a falha do ADR 0036 outra vez, com outro
sujeito: lá o handoff pedia o `<link>` do Google Fonts, a CSP o barrava, e o
sintoma (tipografia inteira caindo em fonte de sistema) só aparecia em
produção.

## Decisão

**1. O tema vira alcançável, e o boot é um ARQUIVO.**

`apps/web/public/theme-boot.js` lê `localStorage['brabo.theme']`, aceita apenas
`'dark'` ou `'light'`, e escreve `data-theme` no `<html>`. Default `dark`.
Entra no `index.html` como `<script src="/theme-boot.js"></script>`, síncrono e
antes do bundle, ao lado do `/config.js` que já existe pelo mesmo motivo.

Arquivo e não inline porque a CSP é `script-src 'self'`. Síncrono e antes do
bundle porque `data-theme` decide as cores de todo o `tokens.css`: aplicado
depois da hidratação, o usuário do tema claro vê um flash escuro a cada carga.
É ES5 puro sem `import` — o `public/` do vite é copiado como está, sem passar
por build —, e um teste lê o arquivo e reprova se ele deixar de ser.

`apps/web/src/lib/tema.ts` é a metade "produto": `temaAtual`, `aplicarTema`,
`alternarTema`, `observarTema`, mais a chave e o default exportados. O BOTÃO
não mora ali — ele é do shell. Os dois arquivos repetem a chave e o default
porque o de boot não pode importar nada, e um teste em `tema.test.ts` lê o
arquivo de boot e reprova se os dois divergirem: é a única forma de o produto
gravar numa chave e ler de outra.

Nada nesse caminho lança. `localStorage` pode lançar (modo privado, storage
bloqueado em iframe) e tema é preferência, não função: falhar ali não pode
derrubar o boot. Valor desconhecido — chave escrita à mão, resto de versão
antiga — cai no default em vez de virar um `data-theme` que o CSS não conhece.

**2. O tema claro passa a ser MEDIDO, e os valores foram corrigidos até
passar.**

Os pares agora são medidos nos dois temas, nos três arquivos que medem
contraste. Seis tokens do tema claro mudaram de valor. Os números são de
`razaoDeContraste` sobre os tokens resolvidos, e o fundo mais exigente do tema
claro é o `--code-bg` (papel, `#efe4d2`, a um passo das superfícies) — quem
fecha contra ele fecha contra todo o resto:

| token (tema claro) | antes | depois | o par que forçava | antes → depois |
|---|---|---|---|---|
| `--accent` | `#c4552d` | `#a5451f` (`--terracota-500`) | keyword sobre `--code-bg` | 3,56 → **4,81** |
| `--accent-hover` | `#a5451f` | `#7e3316` (`--terracota-600`) | seguiu o accent, um degrau abaixo | 4,81 → **7,04** |
| `--warning` | `#b5701c` | `#8a5410` | string sobre `--code-bg` | 3,15 → **4,98** |
| `--success` | `#217e73` | `#136a60` | tipo sobre `--code-bg` | 3,89 → **5,12** |
| `--violet` | `#7b56c9` | `#6b4fb0` (valor do handoff) | número sobre `--code-bg` | 4,16 → **4,95** |
| `--text-muted` | `#80939a` | `#526670` | metadado sobre `--surface-0` | 2,76 → **5,17** |

Dois efeitos colaterais que valem registro. O primeiro: os cinco pares que no
tema escuro são **dívida conhecida** passam os 4,5:1 no claro depois disso —
`--text-muted`/`--surface-1` 3,02 → 5,68, `--text-muted`/`--surface-2` 2,40 →
4,50, `--accent`/`--surface-1` 4,23 → 5,72, `--danger`/`--surface-1` já em
5,59, `--success`/`--surface-2` 3,66 → 4,83. O claro deixou de ter dívida, e
isso é afirmado por teste para não voltar sem ninguém ver. O segundo: a
"exceção conhecida do design system" — `--on-accent` sobre `--accent` a 3,20:1
no botão primário — some no tema claro, porque o conserto que o comentário do
teste descrevia ("escurecer o accent até `--terracota-500`, 5,27:1") é
exatamente o que o claro passou a fazer. No escuro a exceção continua: lá
mexer no accent é mexer na cor da marca sem nada que force.

O `--text-muted` do claro merece nome próprio. A 2,40:1 sobre `--surface-2` ele
não era dívida, era **defeito**: reprovava até o piso de elemento de interface
(3:1), que é o piso mais baixo que existe. Metadado e label são texto, e o
tema claro não tem por que ser pior que o primário — o valor novo fica em
5,17 sobre `--surface-0`, acima dos 4,81 que o escuro já entregava.

**3. Os oito papéis de sintaxe ganham token próprio, e o valor do handoff só
entra quando a medição aprova.**

A paleta de realce era três tokens (`--syntax-function`, `--syntax-comment`,
`--syntax-operator`) e cinco reusos de semântico. Passa a ser os oito papéis do
handoff, com o prefixo `--syntax-*` que o repositório já usa e com valor
próprio por tema. Nomear os oito é o que permite que o realce divirja do
semântico no dia em que precisar — que é justamente o que o handoff faz.

**Cinco dos oito valores do handoff foram recusados por medição**, e é o item
que mais importa deste ADR. Contra o próprio `--code-bg` do handoff:
`--syn-cm` dá 4,09:1 no escuro e 2,32:1 no claro; `--syn-kw` 4,34:1 no claro;
`--syn-str` 4,20:1; `--syn-fn` 4,14:1; `--syn-op` 4,00:1. Todos abaixo dos
4,5:1 que texto de código exige. Onde o handoff reprova, vale o valor medido —
mesma régua do ADR 0036: a intenção do handoff vale, o número que reprova não.
Os oito fecham 4,5:1 contra `--code-bg` nos DOIS temas, e os cinco semânticos
que ainda pintam de verdade (`SyntaxTokens.module.css` não foi tocado nesta
mudança) vão medidos ao lado deles — enquanto forem o pixel, é deles que o
piso é cobrado.

**4. Os nomes que faltavam entram como ALIAS, nunca como renomeação.**

`--font-display` e `--shadow-modal` são os nomes do handoff para
`--font-heading` e `--shadow-lg`. Entram apontando para eles. Renomear seria um
rename cego por sinônimo em dezenas de arquivos, e a família `--r-*` tem o
mesmo tratamento: `--r-xs` (5px) e `--r-sm` (7px) são novos, `--r-md`/`--r-lg`/
`--r-pill` são alias dos `--radius-*` que já existem, e os `--radius-*` ficam.
Atenção a um degrau que não coincide: `--r-sm` é 7px e `--radius-sm` é 4px —
não são sinônimos, e nenhum call site foi migrado aqui.

Entram junto a escala `--fs-*` (oito degraus) e as métricas do shell
(`--sidebar-w`, `--sidebar-w-collapsed`, `--header-h`, `--tabs-h`), que estavam
soltas em cada módulo CSS que desenha a sidebar e a régua de abas.

## Consequências

**O flash de tema deixa de ser possível, e o custo é um request a mais.** O
`theme-boot.js` é um arquivo servido do mesmo origin, cacheável, de algumas
centenas de bytes. Em HTTP/2 ele viaja junto com o `/config.js` que já estava
lá. É o preço de não ter `'unsafe-inline'` na CSP, e é um preço que o ADR 0058
decidiu pagar em geral.

**O tema escuro não mudou um valor.** Nenhum token de `:root` foi alterado —
os cinco pares da dívida conhecida seguem em 3,89 / 3,10 / 3,88 / 3,88 / 4,41,
travados pelos mesmos números de antes. Quem hoje usa o produto não vê
diferença nenhuma; quem ligar o botão vê um tema que passa AA.

**O tema claro ficou mais escuro do que o handoff desenhou.** Os acentos do
claro são um degrau abaixo dos hex que o handoff especifica, e alguém
comparando a tela com o `.dc.html` vai notar. A divergência é deliberada e tem
a mesma forma que a das fontes: o handoff estabelece a intenção (a família, o
papel, o degrau), a medição estabelece o número. Um acento claro bonito que
deixa `const` ilegível numa tela de código não é fidelidade, é fidelidade a um
protótipo que nunca abriu a aba Code.

**Cinco tokens `--syntax-*` novos não têm consumidor ainda.**
`SyntaxTokens.module.css` continua apontando keyword/string/número/tipo/texto
para os semânticos. Isso é escolha: trocar a fiação é mexer no realce da aba
Code e do Markdown do chat, que são de outras frentes, e o teste cobre os dois
conjuntos hoje. O dia em que a fiação mudar, os valores já estarão medidos —
e, no claro, cada papel de sintaxe tem hoje o MESMO número do semântico que o
pinta, de propósito: duas fontes com números diferentes para o mesmo pixel
divergiriam na primeira correção feita de um lado só.

**Três cores de agente continuam hex solto.** `#B9A5E8` (Psicólogo leve),
`#5EBEB1` (Dev Frontend) e `#8AA6AE` (SecOps), em
`apps/web/src/lib/agents.ts`, não têm contraparte semântica em `tokens.css`. A
duplicata do `--violet` (`#9C7BE0`, em dois agentes) foi trocada pelo token; os
três restantes ficaram, declarados no próprio arquivo, porque criar três cores
novas no design system de passagem é decisão de produto e não correção de
caminho. A consequência é conhecida: esses três não mudam com o tema — foram
escolhidos contra o fundo escuro e no claro ficam mais lavados que os outros.

**A preferência é por navegador, não por conta.** Fica em `localStorage`, então
não segue o usuário para outra máquina e não aparece em Configurações. Seguir o
sistema operacional (`prefers-color-scheme`) também ficou de fora:
`lerTemaSalvo()` devolve `null` — e não o default — justamente para que quem
decidir isso depois tenha a informação de que a pessoa nunca escolheu. Hoje
`null` cai em `dark`.

**Uma afirmação de teste foi invertida, e é o tipo de mudança que merece
leitura.** `apps/web/test/design-contraste.test.ts` afirmava por `expect` que
três pares do claro REPROVAM. Não era um teste frouxo: era a dívida escrita na
única linguagem que o CI lê. Com o tema alcançável, a afirmação virou o
contrário — os mesmos pares de auth são cobrados nos dois temas, com o mesmo
piso. Quem ler o histórico desse arquivo vai ver um `toHaveLength(3)` virar
uma bateria de `toBeGreaterThanOrEqual`, e a razão está aqui.

## Referências

- [0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) — as fontes auto-hospedadas: a
  mesma falha (handoff pede recurso que a CSP barra), o mesmo desfecho
  (intenção sim, mecanismo não).
- [0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md) — a política de CSP que torna o script
  inline inviável.
- [RN-182](../business-rules.md#rn-182), [RN-183](../business-rules.md#rn-183),
  [RN-184](../business-rules.md#rn-184), [RN-185](../business-rules.md#rn-185).

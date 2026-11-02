# ADR 0126 — A página do projeto navega por um trilho vertical, e a aba Código para de recolher a sidebar sozinha

- **Status:** aceito
- **Data:** 2026-08-30
- **Referências (sem editar):**
  [ADR 0078](0078-moldura-de-tela-e-o-registro-de-abas-diverge-do-handoff.md)
  (a moldura de tela e o registro de abas — ele moveu o espaçamento da faixa de
  abas para a primitiva `Tabs`, que este ADR agora aposenta da página do
  projeto), [ADR 0074](0074-tema-alcancavel-e-o-boot-sob-csp.md) (a dívida de
  contraste que mantém o selo do contador sólido em vez de tingido),
  [ADR 0125](0125-projectsettingstab-dividido-por-secao.md) (o PR 0 do mesmo
  esforço aceito de 8 PRs do qual este é o PR 1).
- **Revisa:** [RN-201](../business-rules/autenticacao.md#rn-201) — a metade do
  recolhimento automático é removida; a metade de persistência de
  `brabo.project`/`brabo.tab` fica intacta.

## Contexto

A página do projeto tem **12 abas em 3 grupos mais 3 abas soltas**
(`apps/web/src/routes/project-tabs.ts`), renderizadas por uma faixa
horizontal de dois níveis (`components/ui/GroupedTabs.tsx` sobre a primitiva
`Tabs`). Uma revisão de design da UI do produto pôs "trocar a faixa de abas
por um trilho" em primeiro lugar.

**Duas das três justificativas dessa revisão estavam factualmente erradas, e
ficam registradas aqui para ninguém rediscuti-las:**

1. *"O segundo nível abre por cima do conteúdo."* Falso. É uma linha inline
   abaixo da linha de topo — `GroupedTabs.tsx:143`, um `<div>` irmão dentro do
   mesmo invólucro de coluna. Nada nunca sobrepôs nada.
2. *"O contador some quando o grupo está fechado."* Falso. Um grupo fechado
   somava os contadores das filhas e mostrava o total — `somarContagens`,
   `GroupedTabs.tsx:33`, coberto por `GroupedTabs.test.tsx:141`.

**O argumento que sobrevive é a única razão desta mudança: 12 itens numa
barra horizontal não escala.** A faixa foi desenhada para as ~6 abas do
handoff; agrupar comprou espaço escondendo 9 das 12 atrás de um clique, o que
é compressão, não encaixe. Numa janela estreita a linha de topo já rolava
horizontalmente (`Tabs.module.css`, `overflow-x: auto`).

Uma terceira afirmação da revisão — que os cinco contadores deveriam ser
somados em totais de grupo — é **recusada aqui como foi recusada antes**: as
cinco filas (insights, PRs, aprovações, backlog, arquitetura) ficam separadas,
porque somá-las esconde *qual* fila está pedindo atenção. É uma decisão de
produto vigente, já escrita no comentário de doc de `ContagensDeAba` e em
`ProjectPage.tsx`.

## Decisão

`GroupedTabs` é substituído por `apps/web/src/routes/ProjectRail.tsx`, um
trilho vertical entre o cabeçalho do projeto e o painel da aba.

### Os três grupos ficam abertos ao mesmo tempo

É isso que a mudança compra, e é por isso que o cabeçalho de grupo deixou de
ser um botão selecionável e virou um **título**. Não sobra estado de "grupo
aberto", e portanto também não sobra a memória de "última filha visitada por
grupo" (`ultimaFilhaPorGrupo`) — um link direto para uma aba de grupo agora não
precisa de encanamento nenhum para revelá-la, porque ela nunca esteve
escondida.

Os cabeçalhos de grupo reusam as chaves de i18n existentes `groups.*.label` e
os rótulos de aba reusam `tabs.*.label`, as duas no namespace `nav`.
**`project-tabs.ts` não muda**: ele já era a fonte única da estrutura, e o
trilho consome o mesmo `GRUPOS_DO_PROJETO` que a faixa consumia. (A assimetria
conhecida dele — a chave de registro `arquitetura` mapeando para a chave de
i18n `tabs.architecture.label` — fica exatamente como está.)

### Geometria emprestada do trilho do `CodeShell`, não do `Shell`

`routes/code/CodeShell.module.css` (`.rail`/`.railItem`/`.railItemAtivo`) é
**o único trilho do repositório com um estado ativo desenhado**: uma faixa
`--surface-1` com divisória à direita, um item de 32px com `--radius-sm`, e o
item ativo tingido `color-mix(in srgb, var(--accent) 12%, transparent)` sobre
texto `--accent`. A `.trilha` da sidebar (`Shell.tsx:444-477`) não podia ser o
modelo: ela não tem item ativo nem navegação por teclado, então não responde
nenhuma das duas perguntas que este componente tem de responder.

**Uma divergência, declarada:** a largura. O trilho do `CodeShell` tem 48px
porque é só de ícones. Este tem 180px porque carrega *rótulos* de aba e
*títulos* de grupo — que é todo o mecanismo pelo qual três grupos ficam
abertos. Todo o resto (superfície da faixa, divisória, altura do item, raio,
tinta do ativo, hover, anel de `:focus-visible`) é o mesmo tratamento.

O selo do contador fica **sólido** `--accent`/`--on-accent`, não a tinta de
18% do handoff. Essa divergência é deliberada e já está registrada em
`design/SCREENS.md`: o par tingido cai dentro da dívida de contraste (3,88:1)
e este é texto de 10px.

### O contrato de teclado é portado, não abandonado

`GroupedTabs.onKeyDownDaLinha` (`GroupedTabs.tsx:49-71`) tratava
`ArrowRight`/`ArrowLeft`/`Home`/`End` com volta ao início, e dois dos sete
casos de teste dele o cobriam (`GroupedTabs.test.tsx:102,124`). Apagar
acessibilidade testada sem substituí-la é regressão, não refactor, então o
mesmo contrato reaparece no trilho com o eixo trocado:
`ArrowDown`/`ArrowUp`/`Home`/`End`, com volta, selecionando enquanto se move
(ativação automática, a mesma de antes).

A implementação é melhor do que a que substitui. `GroupedTabs` correlacionava
**por posição**, consultando `[role="tab"]` no DOM, porque a primitiva `Tabs`
não expunha refs. O trilho é dono dos próprios botões, então um `Map` de refs
chaveado pela chave da aba dá a correlação sem consultar o documento. As
setas percorrem a lista inteira achatada, cruzando fronteiras de grupo — num
trilho não há "linha de fora" e "linha de dentro" a separar.

ARIA: o trilho é `role="tablist"` com `aria-orientation="vertical"`; os
invólucros de grupo e os títulos deles são `role="presentation"`, o que mantém
as 12 abas como elementos possuídos diretamente pela tablist enquanto as
agrupa visualmente.

### `GroupedTabs` é apagado; `Tabs` fica

Os dois tinham uso único — `GroupedTabs` só por `ProjectPage`, `Tabs` só por
`GroupedTabs` —, mas não são o mesmo tipo de coisa, e a evidência que decide é
`ds-bundle/`, o design system gerado **a partir deste app**
(`.ds-build-meta.json`: `source: web@0.1.0`, 66 componentes, namespace
`BraboDS`):

- **`Tabs` está nele**, como `components/primitivas/Tabs` — três entradas em
  `_ds_sync.json` (`.jsx`, `.d.ts`, `.prompt.md`) e uma story em
  `.stories-map.json`. Apagá-lo encolheria o design system como efeito
  colateral da mudança de layout de uma tela. Uma primitiva genérica sem
  consumidor atual é estoque, não código morto. Ela fica, com um comentário
  dizendo por quê.
- **`GroupedTabs` não está nele** — zero ocorrências em todo `ds-bundle/`. Era
  composição específica da página do projeto sobre a primitiva, com
  exatamente um chamador, e sai, junto com a folha de estilo e
  `GroupedTabs.test.tsx`.

## Consequências

### A RN-201 perde a metade do recolhimento automático

A aba Código forçava o recolhimento da sidebar do Shell por
`AutoCollapseContext` / `useAutoCollapseSidebar`
(`apps/web/src/lib/sidebar-state.ts`), registrado por `ProjectCodeTab.tsx` — o
único chamador — e combinado por OU com o recolhimento do Shell em
`Shell.tsx:369-371,412`. **Tudo isso é removido**: o contexto, o hook, o
estado `autoColapsado`, o `Provider` em volta de `<Outlet />`, o estado
`disabled` do botão de recolher que só existia para proteger o caminho
automático, e a string `sidebar.collapseButton.autoCollapsed` nos dois
idiomas.

A razão é estrutural: com um trilho de projeto sempre presente, manter o
recolhimento automático poria o trilho de ícones `.trilha` do Shell
imediatamente ao lado do trilho novo do projeto — dois trilhos verticais
adjacentes, permanentemente, na aba mais pesada do produto.

**O custo é real e foi revisado e aceito antes de isto ser escrito.** Medido
no navegador, não estimado: a aba Código agora renderiza com a sidebar do
Shell **expandida** (264px) + o trilho do projeto (180px) + o trilho próprio
do `CodeShell` (48px) = **492px de moldura antes do primeiro caractere de
código, contra ~110px antes** (sidebar recolhida de 62px + trilho de código de
48px). É uma perda de largura do editor, e é o preço pago.

O que se compra: o recolhimento automático era o *sistema* decidindo pelo
usuário; o recolhimento manual é o *usuário* decidindo. Remover a decisão do
sistema respeitando a do usuário é a troca. O recolhimento manual continua
funcionando e continua persistindo em `brabo.sidebar.collapsed`.

**O trilho duplo não sumiu — ele foi realocado para um estado escolhido pelo
usuário.** Recolher manualmente ainda produz o trilho de ícones do Shell ao
lado do trilho do projeto. A diferença é quem escolheu. Dizer o contrário
seria fingir.

A RN-201 é reescrita no lugar, mantendo o número e a âncora `{#rn-201}`
(âncoras são o contrato). A metade de persistência de
`brabo.project`/`brabo.tab` fica intacta.

### A navegação por abas agora existe em dois lugares — e já existia

`Shell.tsx` renderiza a própria lista de abas por projeto na sidebar
(`LinhaDeAba`, RN-196), lendo o mesmo `ABAS_DO_PROJETO`. Com o trilho, a
página do projeto mostra essas mesmas 12 abas uma segunda vez, algumas
centenas de pixels à direita. **Isso é preexistente, não introduzido aqui** — a
faixa horizontal duplicava a lista da sidebar exatamente do mesmo jeito —, mas
o trilho torna a duplicação visualmente paralela (duas listas verticais dos
mesmos 12 rótulos) onde antes era uma linha contra uma coluna. Conciliar as
duas é uma decisão de produto separada e não é tomada aqui.

### Testes

- `GroupedTabs.test.tsx` (7 casos) é apagado com o componente. Os dois casos
  de teclado reaparecem como cinco no trilho (`ProjectRail.test.tsx`, 17
  casos: grupos abertos juntos, a orientação vertical da tablist e 12 abas
  possuídas, marcação do ativo, link direto, os cinco contadores separados sem
  soma de grupo, uma aba sem contador sem selo, e
  ArrowDown/ArrowUp/Home/End com volta nos dois sentidos).
- **Dois casos em `apps/web/src/routes/project-tabs.test.tsx` foram reescritos
  em vez de mantidos**, e este é o único lugar em que esta mudança edita um
  teste que deveria sobreviver. Os dois afirmavam o contrato do *componente
  que morre* através de `ProjectPage`, não o registro:
  - `'a régua de TOPO mostra os grupos e as abas soltas … nunca as 12 chaves
    achatadas'` afirmava que **exatamente 6** elementos tinham `role="tab"`.
    Todo o propósito do trilho é que as 12 tenham. Reescrito para afirmar a
    mesma ordem declarada, achatada, mais que os três títulos de grupo existem
    e que nenhum deles é uma aba.
  - `'o selo do GRUPO é a SOMA dos selos das filhas'` afirmava um selo de
    grupo somado. Não sobra grupo fechado a resumir, e somar é justamente o
    que este produto deliberadamente não faz. Reescrito para afirmar que cada
    fila mantém o próprio selo e que nenhum título de grupo carrega número.

  Todos os outros casos desse arquivo, e os quatro de `ProjectPage.test.tsx`,
  todo o `Shell.test.tsx` e o describe `'projeto e aba ativos'` em
  `sidebar-state.test.ts`, passam **sem edição**. O describe
  `useAutoCollapseSidebar` em `sidebar-state.test.ts` é apagado porque o hook
  é.
- Suíte inteira do web verde: 142 arquivos, 1 540 testes.

## Alternativas descartadas

- **Um trilho de 48px só de ícones, espelhando literalmente o `CodeShell`.**
  Recusada: 12 abas precisariam de 12 ícones distintos que não existem, e os
  três títulos de grupo — o mecanismo que torna legíveis os grupos simultâneos
  — não têm forma de ícone nenhuma. O resultado seria uma fileira de quadrados
  sem rótulo, cada um precisando de tooltip, o que é pior que a faixa que
  substitui.
- **Manter `GroupedTabs` e torná-lo vertical.** Recusada: o que sobreviveria é
  a divisão nível de topo/segundo nível, e essa divisão é exatamente o que está
  sendo removido. O código restante — o handler de teclado posicional no DOM,
  `somarContagens`, `ultimaFilhaPorGrupo` — é todo maquinário para esconder
  filhas.
- **Manter o recolhimento automático e deixar os dois trilhos adjacentes.**
  Recusada: entrega ao usuário um trilho duplo permanente, imposto pelo
  sistema, na aba em que o espaço horizontal mais importa, e o usuário não
  consegue desfazê-lo (o botão de recolher ficava desabilitado justamente
  enquanto o recolhimento automático estava ligado).
- **Apagar `Tabs` também, já que agora não tem chamador.** Recusada por
  evidência: é uma primitiva publicada do design system, e a mudança de layout
  de uma tela não é razão para mudar o inventário do DS.

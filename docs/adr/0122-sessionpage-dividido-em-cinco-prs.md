# ADR 0122 — `SessionPage.tsx` dividido em cinco PRs mecânicos, declarados de antemão

- **Status:** aceito
- **Data:** 2026-08-29
- **Referencia (sem editar):** [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)
  (o mesmo formato de raciocínio deste — um arquivo compartilhado cresceu além
  do ponto em que "só contornar" sai mais barato que traçar uma fronteira —,
  mas outro formato de execução: o 0121 foi um commit de diff zero, este são
  cinco PRs em sequência, porque o arquivo está sob mudança ativa de features
  e um PR único congelaria o código ou disputaria corrida com toda outra
  mudança).

## Contexto

`apps/web/src/routes/SessionPage.tsx` tem 3 807 linhas e 169 KiB — a revisão
de dívida técnica de `docs/explanation/backlog.md` já tem uma linha para ele:

> Decompose `SessionPage.tsx` / `ProjectSettingsTab.tsx` | G | `SessionPage.tsx`
> is 169 KiB with 25 test files importing it; `ProjectSettingsTab.tsx` is
> 90 KiB | already informally called a "disputed file" in
> historico-de-fases.md, but never promoted to a tracked debt item; per the
> standing rule this is its own phase, never a drive-by refactor

Três custos concretos fazem disso mais que uma queixa de tamanho:

1. **25 arquivos de teste dependem dele** (`SessionPage.*.test.tsx` mais
   `SessionPage.ponto.test.ts`) — qualquer mudança estrutural arrisca um raio
   de impacto largo, e o tamanho do arquivo torna difícil saber de antemão
   quais dos 25 uma dada mudança pode tocar.
2. **O arquivo está sob mudança ativa, não é código legado.** 50 commits o
   tocaram; os 15 mais recentes são quase todos acréscimos `feat` (perguntas
   estruturadas, handoff, a faixa de atividade do turno, a ordenação
   turno/desfecho da RN-172…), e nenhum deles foi uma extração — esta é a
   primeira tentativa de traçar uma fronteira interna na história do arquivo.
   Isso descarta uma reescrita de uma vez: congelar o arquivo para um PR
   grande bloquearia toda outra feature que caísse nele ou forçaria rebases
   dolorosos e repetidos.
3. **A suíte de testes já traça parte da fronteira.** Antes deste PR,
   `SessionPage.ordenacao-e-avisos.test.tsx` importa `aberturasDeTurno`,
   `turnoDoSeq`, `afundarDesfechos`, `ordemDaAcaoNaTimeline` e
   `agruparNarracoesDoTurno` **direto pelo nome** de `./SessionPage`
   (`await import('./SessionPage')`, desestruturado), e
   `SessionPage.ponto.test.ts` faz o mesmo com `pontoDaSessao` — não
   renderizando o componente, mas como chamadas de função simples. Os testes
   já tinham decidido que essas cinco (mais `agruparNarracoesDoTurno`) são
   unidades independentes; este ADR promove essa fronteira existente a uma
   fronteira real de módulo, em vez de inventar uma nova.

Dados a mudança ativa e o raio de impacto, vale a regra permanente do
`CLAUDE.md` — "não é refatoração de passagem" —, então isto é uma fase
própria, planejada como uma sequência de PRs mergeáveis de forma
independente e neutros em comportamento, cada um evidenciado pelos mesmos 25
arquivos de teste passando **sem edição**.

## Decisão

Cinco PRs, executados e mergeados um de cada vez (nunca em paralelo — cada um
chega à `dev` antes de o próximo começar), nesta ordem:

1. **Helpers puros de timeline/turno → `apps/web/src/lib/session-timeline.ts`**
   (este PR). `aberturasDeTurno`, `turnoDoSeq`, `afundarDesfechos`,
   `pontoDaSessao`, `ordemDaAcaoNaTimeline` e o tipo `TimelineEntry` que eles
   compartilham. Os cinco foram confirmados puros — sem JSX, sem referência a
   `styles`/CSS module, sem closure sobre estado do componente —, o que faz
   desta a fatia de menor risco e a certa para ir primeiro: uma mudança
   mecânica de `.ts`, sem nada a conciliar com o ciclo de render do React.
   `agruparNarracoesDoTurno` fica em `SessionPage.tsx` de propósito, embora
   esteja na mesma região e seja testado do mesmo jeito: ele devolve JSX
   (`<Disclosure>`) e lê três nomes de classe `styles.narracoes*` de
   `SessionPage.module.css`. Movê-lo significaria decidir que `lib/` aceita
   seu primeiro arquivo `.tsx` — hoje ela só tem fontes `.ts` (existem alguns
   **testes** `.tsx`, mas zero arquivos **fonte** `.tsx`) —, e esse
   precedente pertence a um PR que de fato trate de subcomponentes JSX
   (PR 2), não a um que deveria ser só uma mudança de funções puras.

2. **`StorySlide` → `apps/web/src/routes/StorySlide.tsx`.** O primeiro
   subcomponente JSX a mudar, e o mais simples: um único componente folha (o
   slide do carrossel de promoção, RN-148) sem filhos que também precisem
   mudar. É o PR que decide a questão do compartilhamento de
   `SessionPage.module.css`, tratada abaixo.

3. **`StructuredQuestionCard` + `permiteOutra` → `apps/web/src/routes/StructuredQuestionCard.tsx`.**
   Outro subcomponente JSX autocontido (o formulário de pergunta estruturada
   da RN-162/RN-171) mais o único helper puro de que ele depende em privado —
   movidos juntos porque separar um componente do único helper que só ele
   chama acrescentaria um arquivo sem benefício para leitor nenhum.

4. **Helpers da árvore do backlog + `ItemDeBacklog` + `ContextAside` → `apps/web/src/lib/session-backlog-tree.ts` + `apps/web/src/routes/ContextAside.tsx`.**
   A maior fatia: helpers puros de montagem da árvore (a casa natural deles é
   `lib/`, mesmo raciocínio do PR 1) ao lado do JSX que os renderiza
   (`ItemDeBacklog`, `ContextAside` — casa natural em `routes/`, mesmo
   raciocínio dos PRs 2–3). Vem depois das mudanças mais simples de
   componente único justamente por ser uma extração de dois arquivos e de
   dois tipos, e ganha com os PRs 2–3 já terem respondido uma vez a questão do
   compartilhamento de CSS.

5. **Flags de prontidão → `apps/web/src/lib/session-readiness.ts`, um hook
   `useSessionReadiness`.** O último, e o único PR do conjunto que **não** é
   uma mudança de arquivo: as flags de prontidão (os portões da RN-160/RN-161
   nos botões do Arquiteto/PO) são calculadas em linha a partir de estado e
   props que moram em `SessionPage.tsx`, então extraí-las significa escrever
   um hook novo com contrato explícito de entrada/saída, não realocar uma
   função ou componente avulso existente. Vem por último porque é o mais
   arriscado dos cinco — uma fronteira de hook pode mudar *quando* algo é
   recalculado mesmo com a fórmula intacta —, e no PR 5 os outros quatro já
   terão encolhido o arquivo o bastante para esse risco ser mais fácil de
   revisar isolado.

### A questão do compartilhamento de `SessionPage.module.css`, respondida uma vez

`SessionPage.module.css` tem hoje exatamente um importador — o próprio
`SessionPage.tsx` (verificado: um `grep` pelo especificador em `apps/web/src`
fora dos arquivos de teste devolve um resultado). Isso quer dizer que os
PRs 2–4 podem fazer seus arquivos irmãos recém-extraídos (`StorySlide.tsx`,
`StructuredQuestionCard.tsx`, `ContextAside.tsx`) importarem
`../routes/SessionPage.module.css` direto, do mesmo jeito que
`SessionPage.tsx` faz hoje — sem dividir o CSS, sem folha de estilo
compartilhada nova, sem risco de as duas cópias divergirem, porque nunca
houve uma segunda cópia. É uma decisão que vale escrever uma vez, aqui, em
vez de rediscuti-la em três revisões de PR separadas.

### Explicitamente fora do escopo de todo o esforço de cinco PRs

Duas coisas ficam intocadas por este ADR e pelos cinco PRs:

- **O agrupamento de estado do canal de turno**: `turnoViaCanal`,
  `statusAgent`, `pensandoVisivel`, `atividadeDoTurno`. Esses quatro estados
  são lidos E escritos por quatro handlers diferentes de entrada de turno
  (`handleSend`, `handleReadiness`, `handleArchitectureReadiness`,
  `handleAcceptHandoff`) e capturados em closure por `finalizarTurnoDoAgente`,
  que o comentário no código chama de "o ÚNICO lugar que finaliza um turno" —
  cada um desses quatro handlers liga `turnoViaCanal`, e só
  `finalizarTurnoDoAgente` o desliga. Não é uma subárvore JSX contígua nem um
  conjunto de funções puras; é fluxo de controle entrelaçado, e movê-lo é
  uma decisão de desenho sobre onde o estado do ciclo de vida do turno deve
  morar, não uma realocação mecânica. Ele ganha um ADR próprio, posterior e
  com número separado, quando esse trabalho for delimitado.
- **`apps/web/src/routes/ProjectSettingsTab.tsx`** (~90 KiB, o outro arquivo
  citado na mesma linha do backlog). Menor, já tem um primeiro passo próprio
  em andamento (funções nomeadas dentro do arquivo, ainda não extraídas para
  módulos), e é uma decisão de escopo separada — este ADR cobre só
  `SessionPage.tsx`.

## Consequências

- **Duas pessoas podem trabalhar em cantos diferentes de `SessionPage.tsx`
  com menos sobreposição** depois que os cinco PRs entrarem — o mesmo
  benefício que o ADR 0121 descreveu para a divisão do schema, em escala
  menor (cinco unidades extraídas, não dezesseis arquivos).
- **O critério de aceite de todo PR deste conjunto é o mesmo: zero mudança de
  comportamento observável**, provado pelos mesmos 25 arquivos
  `SessionPage.*.test.tsx` passando **sem edição** depois de cada PR. Um PR
  deste conjunto que precise editar um desses 25 arquivos para passar não é,
  de fato, mecânico, e deve parar em vez de "consertar" o teste.
- **O agrupamento do canal de turno e `ProjectSettingsTab.tsx` continuam
  exatamente tão disputados quanto antes.** Este ADR não reduz o risco deles
  e não afirma reduzir — nomeá-los aqui é o que mantém o corte declarado em
  vez de estreitado em silêncio. Um PR futuro que toque o agrupamento do
  canal de turno precisa de um ADR próprio, com número novo, que referencie
  este; ele não emenda este, pela regra permanente de que ADR aceito nunca é
  editado.
- **`lib/` ganha seus primeiros arquivos com tipos vizinhos de JSX no formato
  de `TimelineEntry`** (o `TimelineEntry` do PR 1 tem um campo `ReactNode`)
  **sem ganhar seu primeiro arquivo fonte `.tsx`** — é
  `agruparNarracoesDoTurno` ficar em `SessionPage.tsx` que preserva essa
  propriedade no PR 1. O PR 2 é o que gasta esse precedente, de propósito,
  uma vez, com revisão própria.
- **`SessionPage.tsx` encolhe em cinco passos visíveis** (3 807 → menor a
  cada PR) em vez de um diff grande — mais fácil de revisar, mas também quer
  dizer que o arquivo passa o tempo de quatro PRs num estado parcialmente
  decomposto, o que aqui se aceita como o custo de não congelar o trabalho
  ativo de features.

## Alternativas descartadas

- **Um PR grande movendo tudo de uma vez.** Recusado: o arquivo está sob
  mudança ativa (50 commits, os 15 últimos na maioria acréscimos de feature),
  então um PR único ou congela todo outro trabalho em `SessionPage.tsx` até
  ser mergeado ou acumula conflitos de merge mais rápido do que pode ser
  revisado. Dividir em cinco PRs mergeáveis de forma independente deixa o
  trabalho normal de features continuar entre eles.
- **Mover `agruparNarracoesDoTurno` junto com os outros cinco no PR 1**, já
  que ele mora na mesma região do fonte (linhas 281–345) e é testado do mesmo
  jeito. Recusado: ele devolve JSX e lê `styles.narracoes*`, então movê-lo
  decidiria em silêncio que `lib/` aceita arquivos fonte `.tsx` — um
  precedente real que merece revisão própria, não um efeito colateral de um
  PR apresentado como "mudança de função pura".
- **Extrair o agrupamento do canal de turno como parte deste mesmo plano**,
  já que é o outro grande bloco de estado do arquivo. Recusado de saída: é
  fluxo de controle acoplado entre quatro handlers, não uma fronteira que a
  suíte de testes já traça, e o comentário no código já o nomeia como o único
  lugar que precisa ficar sincronizado — exatamente o tipo de mudança que o
  critério de aceite "mecânico, comprovadamente neutro em comportamento"
  deste ADR não pode afirmar com honestidade que cobre.

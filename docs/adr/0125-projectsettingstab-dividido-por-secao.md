# ADR 0125 — `ProjectSettingsTab.tsx` dividido em um arquivo por seção, atrás de um barrel

- **Status:** aceito
- **Data:** 2026-08-30
- **Referências (sem editar):**
  [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md) (o irmão mais
  próximo — uma decomposição apoiada em barrel cuja régua de aceite era "os
  importadores não mudam nada"; este ADR reusa essa forma do lado do web),
  [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md) e
  [ADR 0124](0124-hook-do-canal-de-turno-do-sessionpage.md) (os dois nomearam
  este arquivo e os dois o adiaram explicitamente — "uma decisão de escopo
  totalmente separada, ainda aberta"; este ADR é essa decisão, tomada).

## Contexto

`apps/web/src/routes/ProjectSettingsTab.tsx` tem 2 532 linhas e 89,9 KiB. Ele
é a **última** metade aberta da linha de dívida técnica em
`docs/architecture.md` e `docs/explanation/backlog.md`:

> Decompose `SessionPage.tsx` / `ProjectSettingsTab.tsx` | G |
> `SessionPage.tsx` was 169 KiB with 25 test files importing it;
> `ProjectSettingsTab.tsx` is 90 KiB

A metade de `SessionPage.tsx` fechou ao longo de sete PRs e dois ADRs (0122,
0124). Os dois ADRs nomearam `ProjectSettingsTab.tsx` nas seções "fora de
escopo" em vez de estreitar a linha em silêncio — e é exatamente por isso que
ele ainda está aqui, e por que fechá-lo precisa de um número próprio em vez de
um refactor de passagem.

**Este arquivo é estruturalmente muito mais limpo do que `SessionPage.tsx`
jamais foi**, e essa diferença é toda a razão de isto ser um PR em vez de
cinco:

1. **O pai não guarda nada.** `ProjectSettingsTab` (linhas 217–239 antes
   desta mudança) é 17 filhos JSX e uma interface de props. Nenhum hook,
   nenhum `useQuery`, nenhum `useQueryClient`, nenhum `useTranslation`,
   nenhuma checagem de papel, nenhum `useState` — nada a distribuir nem a
   reconciliar com o ciclo de render do React.
2. **Nenhuma seção recebe mais que `{ projectId: string }`,** e duas
   (`MatrixSection`, `CredentialsSection`) não recebem props nenhuma. Não há
   prop-drilling de dados, nem contexto, nem `useState` compartilhado, nem
   callback passado para baixo. Cada seção chama os próprios hooks e é dona
   das próprias queries.
3. **11 das 17 seções já são exportadas** — a suíte de testes já tinha
   desenhado a maior parte da fronteira, o mesmo argumento que o ADR 0122 fez
   para os cinco helpers de timeline do `SessionPage`.

A duplicação entre seções é **deliberada, e fica**:
`useTranslation('settings')` aparece ~14×, `useQueryClient()` 11×,
`useToast()` 10×, `useCurrentWorkspaceWithRole()` 5× e
`useQuery({ queryKey: ['project', projectId] })` 7×. O React Query deduplica
essas chamadas em runtime — é isso que torna o padrão seguro, e o que torna
cada seção montável de forma independente. Içá-las para um pai compartilhado
ou um contexto seria uma mudança de comportamento vestida de limpeza, e não é
feito aqui.

## Decisão

Um arquivo por seção em `apps/web/src/routes/settings/`, mais um módulo de
helpers compartilhado — 18 arquivos novos — e **`ProjectSettingsTab.tsx` fica
no caminho atual como ponto de entrada e barrel**.

### O barrel é estrutural, não decorativo

Três arquivos de teste dependem do caminho ou dos nomes exportados, e os três
precisam passar **sem edição** — essa é toda a régua de aceite deste PR:

- `apps/web/src/routes/ProjectSettingsTab.test.tsx` (1 356 linhas, 62 `it`s)
  importa **11 exports nomeados** de `./ProjectSettingsTab`.
- `apps/web/src/routes/ProjectPage.test.tsx` e
  `apps/web/src/routes/project-tabs.test.tsx` fazem os dois
  `vi.mock('./ProjectSettingsTab', …)` **pelo caminho** — mover ou renomear o
  arquivo quebra os dois mocks em silêncio.
- `apps/web/src/routes/ProficiencySection.test.tsx` importa o próprio
  `ProjectSettingsTab` e o renderiza, o que o torna o único teste que monta as
  17 seções de uma vez — a prova de ponta a ponta de que o barrel está ligado
  na ordem certa com as props certas.

Mesmo raciocínio do `db/schema.ts` do ADR 0121: o caminho antigo continua
funcionando, então nada a jusante muda. Onde o 0121 usou `export *`, este
barrel nomeia cada export explicitamente, porque uma seção de configurações é
um componente React com um formato de props específico, não uma tabela — uma
lista explícita é o que deixa o compilador pegar uma seção que deixa de casar
com o ponto de chamada. Seções novas entram no barrel **na posição do
assunto, nunca acrescentadas no fim** — a mesma regra que o 0121 fixou, e aqui
a posição é literal: a lista de imports do barrel, a de re-exports e o JSX
seguem todos a ordem de render.

### Os 17 arquivos, em ordem de render

| arquivo | linhas | exportado pelo barrel |
|---|---|---|
| `settings/RepositorySection.tsx` | 80 | não |
| `settings/ExecutionSection.tsx` | 88 | sim |
| `settings/ExecutionModeSection.tsx` | 174 | sim |
| `settings/ParallelismSection.tsx` | 121 | sim |
| `settings/BudgetSection.tsx` | 132 | sim |
| `settings/PromotionSection.tsx` | 85 | sim |
| `settings/MelhoresModelosPorCapacidadeSection.tsx` | 194 | sim |
| `settings/ModelsSection.tsx` | 334 | sim |
| `settings/AreaModelsSection.tsx` | 143 | sim |
| `settings/CatalogoDeModelos.tsx` | 17 | não |
| `settings/MembersSection.tsx` | 184 | não |
| `settings/PersonalAccessTokensSection.tsx` | 284 | sim |
| `settings/ProficiencySection.tsx` | 256 | sim |
| `settings/InstructionVersionsSection.tsx` | 161 | não |
| `settings/MatrixSection.tsx` | 65 | não |
| `settings/CredentialsSection.tsx` | 269 | sim |
| `settings/GastoDasChaves.tsx` | 22 | não |
| `settings/shared.ts` | 30 | — |

Uma subpasta, não 18 irmãos em `routes/`: o precedente é `routes/code/`, e 17
arquivos para uma aba é precisamente o tamanho em que uma pasta se justifica.
Isso difere dos PRs 2–4 do ADR 0122, que puseram componentes extraídos
avulsos ao lado de `SessionPage.tsx` — um ou dois irmãos não justificam uma
pasta; dezessete justificam.

### Exportado pelo próprio arquivo, privado ao barrel

As 6 seções que hoje são privadas (`RepositorySection`, `CatalogoDeModelos`,
`MembersSection`, `InstructionVersionsSection`, `MatrixSection`,
`GastoDasChaves`) ganham cada uma um `export` **no próprio módulo** — isso é
consequência mecânica da mudança, não uma decisão: o barrel não consegue
compor uma função que não consegue importar.

Elas **não** são re-exportadas pelo barrel. Essa parte *é* uma decisão, e a
razão é que a lista de exports do barrel é a superfície pública desta aba, e
uma mudança mecânica não deveria alargá-la. Tornar o barrel uniforme nas 17
também seria defensável, mas significaria que este PR mudou algo observável —
o conjunto de exports do módulo — enquanto afirma não mudar nada. Um PR
posterior que de fato precise de uma das 6 a importa do próprio arquivo, o que
agora é possível e antes não era.

### Helpers compartilhados: só o que mais de uma seção chama

Doze helpers de escopo de módulo se moveram. A regra aplicada é mecânica:
**um helper usado por exatamente uma seção vai para o arquivo dessa seção; um
helper usado por duas ou mais vai para `settings/shared.ts`.** Conferido por
grep, não suposto — e a conferência corrigiu uma expectativa: `iniciaisDe`,
`PARES_DE_GRADIENTE` e `gradienteDe` são chamados **só** por
`MembersSection`, nunca por `ProficiencySection`.

- `settings/shared.ts` (2 helpers): `ORIGIN_TONE` (`ModelsSection` +
  `AreaModelsSection`) e `formatarCustoMicros` (`ModelsSection` +
  `BudgetSection`).
- No arquivo do único chamador (10): `USO_TONE` →
  `MelhoresModelosPorCapacidadeSection`; `MATRIX_ROWS` → `MatrixSection`;
  `iniciaisDe`, `PARES_DE_GRADIENTE`, `gradienteDe` → `MembersSection`;
  `siglaDoConector`, `COR_DO_CONECTOR` → `CredentialsSection`; `LEVEL_TONE`
  e `identidadeDe` → `ProficiencySection`;
  `DEFAULT_MAX_CONSECUTIVE_BLOCKED` → `ExecutionSection`;
  `MODOS_DE_EXECUCAO` → `ExecutionModeSection`.

Um `shared.ts` de dois símbolos é pequeno de propósito. A alternativa — um
módulo compartilhado com os doze — poria dez helpers a uma indireção do único
leitor sem benefício nenhum, e faria a próxima pessoa adivinhar se uma
constante é compartilhada. Dois símbolos em `shared.ts` querem dizer
exatamente o que dizem: estes dois, e só estes dois, são de fato
compartilhados.

### O módulo CSS fica único e compartilhado

`ProjectSettingsTab.module.css` mantém o caminho atual e é importado pelos 15
arquivos de seção que o usam (`CatalogoDeModelos` e `GastoDasChaves` só
renderizam um componente delegado e não referenciam classe nenhuma). Uma
folha de estilo, quinze importadores, onde antes havia um.

É a mesma resposta que o ADR 0122 deu para `SessionPage.module.css`, e pela
mesma razão: nunca houve uma segunda cópia, então não há o que divergir.
Bifurcar o arquivo por seção criaria quinze chances de a moldura
`.section`/`.sectionHead`/`.title`/`.eyebrow` — que toda seção renderiza
idêntica — divergir, em troca de nada.

## Consequências

- **`ProjectSettingsTab.tsx` vai de 2 532 linhas / 89,9 KiB para 77 linhas /
  4,1 KiB.** As 17 seções mais `shared.ts` somam 2 639 linhas em 18
  arquivos, a maior sendo `ModelsSection.tsx` com 334. O crescimento sobre o
  original (2 532 → 2 716 incluindo o barrel) é inteiramente cabeçalhos de
  import e o próprio barrel; nenhuma linha do corpo de uma seção mudou.
- **Isto fecha o último item de dívida técnica aberto declarado em
  `docs/architecture.md`.** A linha que nomeava `SessionPage.tsx` e
  `ProjectSettingsTab.tsx` fecha nas duas metades; as linhas restantes dessa
  tabela são outras dívidas (o contrato api↔engine de quatro arquivos, a
  sandbox do `TerminalExecutor`, o critério não fechado da Fase 4a), não esta.
- **A régua de aceite é zero mudança de comportamento observável**, provada
  pela suíte inteira do web — 142 arquivos, 1 537 testes — passando com **zero
  arquivos de teste editados**, incluindo os três que restringem o caminho e
  os nomes exportados. Uma conferência mecânica apoia a revisão: cada bloco de
  cada arquivo novo foi comparado literalmente com o arquivo de antes da
  mudança a partir de `git show dev:…`, e cada linha não vazia do original, do
  cabeçalho de imports para baixo, foi confirmada como tendo caído num arquivo
  de seção ou no barrel. As únicas edições que a mudança fez são as palavras
  `export` acrescentadas listadas acima e os cabeçalhos de import por arquivo.
- **Duas pessoas podem agora editar duas seções de configurações sem tocar o
  mesmo arquivo** — o mesmo benefício que o ADR 0121 reivindicou para o
  schema, com 17 unidades em vez de 16.
- **Quatro melhorias de UI chegam a estes mesmos arquivos em PRs posteriores
  deste mesmo esforço** (o plano aceito de 8 PRs do qual este é o PR 0): um
  sumário com âncoras para a aba, uma redação unificada para valores herdados
  nos quatro lugares que a escrevem de jeitos diferentes, granularidade de
  salvar por seção só para `ParallelismSection`/`BudgetSection`/
  `CredentialsSection` (as três seções de autosave mantêm o autosave, de
  propósito) e uma cadeia legível de origem do modelo em
  `ModelsSection`/`AreaModelsSection`. **Nenhuma delas está neste PR.** Fazer
  a mudança primeiro é o que torna cada uma dessas quatro um diff pequeno num
  arquivo nomeado em vez de um diff grande num de 2 500 linhas — e é por isso
  que o plano a pôs primeiro.
- **A duplicação fica, e fica deliberada.** Quatorze chamadas
  `useTranslation('settings')` agora estão espalhadas por quatorze arquivos em
  vez de concentradas num só, o que torna o padrão *mais* visível, não menos.
  Não é um defeito a corrigir depois: as seções são montáveis de forma
  independente justamente porque nenhuma depende de um pai ter chamado um hook
  antes.

## Alternativas descartadas

- **Dividir em cinco PRs, como o ADR 0122 fez para `SessionPage.tsx`.**
  Recusada: a forma de cinco PRs do 0122 foi imposta por churn ativo (50
  commits, 25 arquivos de teste dependentes, fluxo de controle entrelaçado) e
  pelo PR 5 não ser uma mudança de arquivo. Aqui toda seção já é
  independente, o pai não guarda estado, e cada arquivo é um bloco contíguo
  idêntico byte a byte — o argumento do churn não se aplica e cinco PRs seriam
  cinco revisões do mesmo diff trivial.
- **Apagar `ProjectSettingsTab.tsx` e apontar `project-tabs.ts` para um
  `settings/index.tsx`.** Recusada por evidência, não por gosto: dois arquivos
  de teste fazem `vi.mock` do módulo pelo caminho e um terceiro importa 11
  nomes dele. A rota continuaria funcionando; três arquivos de teste
  quebrariam por uma renomeação que não compra nada.
- **Içar as queries compartilhadas (`['project', projectId]`, `useToast`,
  `useTranslation`) para o pai e passar os resultados para baixo.** Recusada:
  converte 17 componentes autossuficientes em 17 componentes com um contrato
  de pai, o que é mudança de desenho, não de lugar — e o React Query já
  deduplica as buscas, então a "duplicação" não custa nada em runtime. Também
  tornaria cada seção impossível de montar isolada, que é exatamente como
  `ProjectSettingsTab.test.tsx` exercita 11 delas hoje.
- **Pôr os doze helpers de escopo de módulo em `shared.ts`.** Recusada: dez
  dos doze têm exatamente um chamador, e um módulo compartilhado que guarda
  helpers privados para de responder a pergunta que existe para responder.

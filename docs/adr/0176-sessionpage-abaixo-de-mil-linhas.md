# 0176 — `SessionPage.tsx` abaixo de 1 000 linhas, em dez PRs mecânicos, e a trava só depois

## Status

**Accepted.** 2026-09-28 (AT-138, `BRB-015`). Decisão do mantenedor
(2026-09-27): **sim, e travar depois** — decompor
`apps/web/src/routes/SessionPage.tsx` até abaixo de 1 000 linhas em PRs
mecânicos, e só então transformar o teto em trava de CI.

Referencia, sem editar, o [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md)
(os cinco PRs mecânicos que levaram o arquivo de 3 807 a 2 661 linhas e
decidiram que os irmãos extraídos importam `SessionPage.module.css` direto), o
[ADR 0124](0124-hook-do-canal-de-turno-do-sessionpage.md) (o cluster do canal
de turno em `useTurnoDoAgente`, que este programa NÃO toca) e o
[ADR 0125](0125-projectsettingstab-dividido-por-secao.md) (a mesma régua de
"os importadores não mudam nada", aplicada ao `ProjectSettingsTab.tsx`).

## Contexto

A linha de dívida do `SessionPage.tsx` fechou em 2026-08-30, pelos ADRs 0122 e
0124, em **2 479** linhas. Ela fechou por um NÚMERO, e nada mediu o número
depois: em 2026-09-13 o arquivo tinha 2 559 linhas (a `architecture.md` passou
a declarar isso, AT-031), e na `origin/dev` de hoje (`018b8cd24c`, medido com
`wc -l`) tem **2 637 linhas e 122 379 bytes**. Ninguém fez nada errado — cada
acréscimo foi uma funcionalidade legítima (o filtro de aptos, o card do handoff
da Infra, a recusa de sessão encerrada, o Infra Lead no composer) — e é
exatamente por isso que a regressão aconteceu: sem trava, a dívida volta como
soma de decisões certas.

O que o arquivo era, medido antes deste programa:

- **Um componente de ~2 400 linhas.** O corpo de `SessionPage` ia da linha 237
  à 2 637. Fora dele só havia os imports, a reexportação das funções de
  timeline e `agruparNarracoesDoTurno`.
- **O maior bloco era um `useMemo` de 762 linhas**, a montagem da timeline:
  um nó JSX por tipo de evento, a leva de histórias aguardando promoção
  (RN-126/RN-148) e os cards de aprovação (RN-155).
- **O JSX devolvido tinha ~625 linhas** em três faixas independentes: a barra
  do topo, o conteúdo do fio que rola, e a faixa de baixo (card da Infra,
  handoff manual, composer).
- **Os handlers eram ~500 linhas**, em três famílias: os de TURNO
  (`handleSend`, `handleCancel`, `handleReadiness`,
  `handleArchitectureReadiness` — a porta do cluster do ADR 0124), os de
  PROMOÇÃO de histórias e os de HANDOFF/EXECUÇÃO que não são turno.
- **28 arquivos `SessionPage.*.test.tsx`**, 173 testes, todos com `vi.mock` de
  MÓDULO (`../lib/api-client`, `../lib/hooks`, `../lib/session-channel`…). Um
  mock de módulo vale para qualquer arquivo que importe o módulo, então código
  movido para um arquivo irmão continua mockado — é isso que torna viável mover
  sem editar teste.

## Decisão

**Dez PRs, empilhados em ordem** (cada um sobre o anterior, `--base` a branch
do anterior), cada um MECÂNICO: mover código sem mudar comportamento — nada de
refatorar lógica, renomear a API pública do componente ou "melhorar de
passagem". A régua de aceite é a do ADR 0122, palavra por palavra: **os 28
arquivos de teste existentes passam SEM EDIÇÃO**. PR que precisar editar um
deles não é mecânico e para.

O `SessionPage.tsx` sai de **2 637** e chega a **834** linhas (−1 803):

| PR | O que sai | Para onde | `SessionPage.tsx` depois |
|---|---|---|---|
| — | ADR 0176 (este documento) | `docs/adr/` | 2 637 |
| 1 | `agruparNarracoesDoTurno`, `FIO_RECENTES_ABERTAS`, o corpo dos `useMemo` `timelineAgrupada` (colapso por agente, RN-138) e `fio` (corte por origem, RN-177) | `routes/session-fio.tsx` (`agruparTimelinePorAgente`, `dividirFio`) | 2 445 (−192) |
| 2 | o corpo do `useMemo` `timeline` (762 linhas) | `routes/session-timeline-montagem.tsx` (`montarTimeline`) | 1 718 (−727) |
| 3 | a barra do topo | `routes/SessionTopbar.tsx` | 1 561 (−157) |
| 4 | o conteúdo do fio (convite, histórico, recentes, otimista, bolha de streaming) | `routes/SessionFio.tsx` | 1 390 (−171) |
| 5 | a faixa de baixo (card da Infra, handoff manual, composer) | `routes/SessionComposer.tsx` | 1 225 (−165) |
| 6 | `activeFor`, `offeredHandoff`, `handoffDaInfraOferecido` e os três "já declarado" | `lib/session-handoffs.ts` (`derivarHandoffsDaSessao`) | 1 163 (−62) |
| 7 | os quatro refs e os quatro efeitos de rolagem, e `rolarParaOFim` | `lib/session-rolagem.ts` (`useRolagemDoFio`) | 1 094 (−69) |
| 8 | os cinco estados e os três handlers de promoção de histórias, e o modal de devolução | `lib/session-promocao.ts` (`usePromocaoDeHistorias`) + `routes/DevolverHistoriaModal.tsx` | 982 (−112) |
| 9 | os quatro estados e os cinco handlers de handoff/execução que não são turno (RN-406, RN-440, RN-161, RN-137, RN-153) | `lib/session-acoes-de-handoff.ts` (`useAcoesDeHandoff`) | 834 (−148) |
| 10 | **a trava** | `routes/SessionPage.teto.test.ts` | 834 |

**A ordem vai do menos arriscado ao mais**, como no ADR 0122: primeiro o que é
função pura ou quase (PRs 1–2), depois JSX sem estado (PRs 3–5), depois
derivação pura (PR 6), e por último os HOOKS (PRs 7–9), que são os únicos que
mexem na ordem dos hooks do componente.

**O que "mecânico" quer dizer em cada espécie de recorte**, decidido uma vez
aqui para não ser relitigado em dez revisões:

1. **Corpo de `useMemo` vira função chamada DE DENTRO do mesmo `useMemo`, com
   a MESMA lista de dependências, byte a byte** — inclusive as que ela não
   lista. A montagem da timeline fecha sobre handlers (`handlePromoteStory`,
   `handleAcceptHandoff`…), `t` e `semRepositorio` que nunca estiveram nas
   dependências; completar a lista mudaria QUANDO a timeline se refaz, e isso é
   comportamento. O `oxlint` continua avisando (`exhaustive-deps` é `warn`) o
   que já avisava antes.
2. **Bloco JSX vira componente cujas props têm os MESMOS nomes** que o bloco
   lia do escopo do `SessionPage`. O componente chama o próprio
   `useTranslation('sessionPage')`. Bloco com vários irmãos vira fragmento.
   O `{recusandoStory && …}` do modal foi junto, dentro do componente.
3. **Derivação pura vira função pura** que devolve os mesmos nomes, calculada
   a cada render como era.
4. **Estado + handlers viram hook** chamado no MESMO ponto em que os efeitos
   estavam (PR 7), ou logo depois de `useTurnoDoAgente` quando os handlers
   dependem dele (PRs 8–9). A posição dos `useState` na ordem dos hooks muda, e
   isso não é observável: o React só exige a mesma ordem entre um render e o
   seguinte. Os handlers continuam sendo funções recriadas a cada render, como
   eram as `async function` do componente.
5. **Sem JSX vai para `lib/*.ts`; com JSX fica em `routes/*.tsx`** e importa
   `SessionPage.module.css` direto — a resposta do ADR 0122 à pergunta do CSS,
   reaproveitada sem reabrir. `lib/` continua sem `.tsx` de código.
6. **Os comentários vão junto com o código**, inclusive os que dizem "aqui" ou
   "logo abaixo" — o arquivo novo diz no topo de onde eles vieram. Reescrever
   comentário de passagem é o "melhorar de passagem" que o programa proíbe.
7. **`SessionPage.tsx` reexporta o que os testes importam dele**:
   `agruparNarracoesDoTurno` saiu para `session-fio.tsx` e segue reexportada,
   pelo mesmo motivo das quatro funções de timeline do ADR 0122.

**A trava nasce no ÚLTIMO PR, e não antes.** É um teste do web
(`SessionPage.teto.test.ts`) que reprova `SessionPage.tsx` com **1 000 linhas
ou mais**, contando como o `wc -l`, e que prova a própria contagem nas duas
bordas (999 passa, 1 000 reprova) — medido também por mutação, acrescentando
166 linhas ao arquivo real. Ela mora no web, e não em `scripts/ci/`, porque
roda na suíte que todo PR que toca o arquivo já roda.

### Fora de escopo, de propósito

- **Os handlers de TURNO** (`handleSend`, `handleCancel`, `handleReadiness`,
  `handleArchitectureReadiness`, `avisarSessaoEncerrada`) e os de ciclo de
  vida da sessão (`handleActivate`, `handleClose`, `handleRename`,
  `handleStartIdeation`) ficam no `SessionPage`. Os de turno são a porta de
  entrada do cluster que o ADR 0124 moveu para `useTurnoDoAgente` e deixou
  chamado DAQUI; tirá-los seria decidir de novo onde mora o turno, e isso não
  é mecânico. O teto foi alcançado sem eles.
- **`useTurnoDoAgente`, `useSessionReadiness`, `ContextAside`,
  `StructuredQuestionCard`, `StorySlide`** — já extraídos, não mudam.
- **Nenhuma lista de dependências é "corrigida"**, nenhum handler vira
  `useCallback`, nenhum nome de prop ou de função muda. Cada uma dessas seria
  uma mudança de comportamento ou de API, e cada uma, se valer a pena, é um PR
  próprio que não se apresenta como mecânico.

## Consequências

- **O arquivo sai de 2 637 para 834 linhas**, com 166 de folga até a trava.
  A folga é de propósito: o teto não pode ser a próxima funcionalidade a cair
  nele. Quem precisar passar de 999 tira um recorte — há candidatos declarados
  acima —, nunca sobe o número. Subir o teto é ADR novo, que referencia este.
- **A soma das linhas CRESCE**: os dez arquivos novos têm 2 574 linhas contra
  as 1 803 que saíram, porque cada um ganhou imports próprios, um bloco de
  props ou de contexto, e um cabeçalho dizendo de onde veio. É o preço de
  fronteiras explícitas, e é o mesmo que o ADR 0125 aceitou.
- **O maior arquivo novo tem 861 linhas** (`session-timeline-montagem.tsx`,
  quase todo o `useMemo` original). Ele NÃO ganha trava aqui: a dívida
  declarada é a do `SessionPage.tsx`, e travar arquivo que acabou de nascer
  seria o erro que a AT-031 nomeou. Se ele crescer, o próximo recorte natural
  é um arquivo por família de evento.
- **As referências `arquivo:linha` para `SessionPage.tsx` em
  `docs/business-rules.md` e `docs/business-rules/autenticacao.md` mudaram de
  lugar** — muitas já estavam defasadas antes deste programa. Elas são
  atualizadas no PR 10, uma vez, quando as linhas param de andar; nos PRs
  1–9 o `verificarRefsComSimbolo` (em `warn`) avisa.
- **`BRB-015` deixa de reproduzir** no PR 10, e a linha da `architecture.md`
  que declarava a regressão fecha junto, apontando para a trava.
- **Os PRs empilhados mergeiam em ordem.** Um PR de funcionalidade que tocar
  `SessionPage.tsx` entre dois deles rebaseia sobre o recorte — o custo que o
  ADR 0122 já tinha aceitado por não congelar o arquivo.

## Alternativas descartadas

- **Travar antes de decompor**, com o teto no número de hoje, descendo a cada
  PR. Recusada pelo mantenedor: um teto que acompanha a descida é um número a
  editar em todo PR do programa, e um teto fixo acima do arquivo não impede
  nada. A trava só tem valor como o NÃO de "voltou a crescer", e isso só existe
  depois de chegar.
- **Um PR só.** Recusado pelo mesmo motivo do ADR 0122: 1 800 linhas movidas
  num diff não se revisam, e o arquivo segue recebendo funcionalidade.
- **Levar os handlers de turno junto** para chegar mais longe. Recusado: é o
  cluster que o ADR 0124 decidiu, e o teto não precisou dele.
- **Um arquivo por tipo de evento já no PR 2.** Recusado para este programa:
  quebrar o `useMemo` em funções por evento exige decidir a assinatura de cada
  uma (a leva de promoção e o `continue` do laço atravessam tipos), e isso
  deixa de ser mover. Mover o corpo inteiro primeiro é o que permite que esse
  corte, se vier, seja revisado sozinho.

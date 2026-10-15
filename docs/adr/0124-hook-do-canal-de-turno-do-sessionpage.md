# ADR 0124 — Agrupamento de estado do canal de turno extraído para `useTurnoDoAgente`

- **Status:** aceito
- **Data:** 2026-08-30
- **Referências (sem editar):** [ADR 0122](0122-sessionpage-dividido-em-cinco-prs.md)
  (este ADR é o "ADR próprio, posterior, com número separado" que a seção de
  Consequências do 0122 nomeou e adiou); o PR de deduplicação mecânica sobre o
  qual esta extração se apoia (`refactor(web): termina a deduplicação do
  arme de turno no SessionPage.tsx`, mergeado antes deste ADR, sem ADR
  próprio — referenciado aqui como pré-requisito, o mesmo padrão que o 0122
  usou ao referenciar o [ADR 0121](0121-schema-dividido-por-agregado-de-dominio.md)
  sem editá-lo).

## Contexto

O ADR 0122 deixou o agrupamento de estado do canal de turno fora da sua
decomposição mecânica de `SessionPage.tsx` em cinco PRs, de propósito,
chamando-o de "fluxo de controle entrelaçado, [...] uma decisão de desenho
sobre onde o estado do ciclo de vida do turno deve morar, não uma realocação
mecânica" e nomeando `turnoViaCanal`, `statusAgent`, `pensandoVisivel`,
`atividadeDoTurno` como "lidos E escritos por quatro handlers de entrada de
turno diferentes (`handleSend`, `handleReadiness`,
`handleArchitectureReadiness`, `handleAcceptHandoff`)". Este é o trabalho
adiado.

Reler o arquivo linha a linha para delimitar o escopo mostrou que a própria
contagem do ADR 0122 ficou abaixo da real: ele nomeia quatro handlers de
entrada de turno, mas há **sete** pontos de entrada de escrita reais nesse
agrupamento. Os três que ele nomeou mais `handleAcceptHandoff` são quatro; os
outros três são o próprio efeito do canal (os handlers `onAgentDelta`/
`onToolCall`/`onAgentDone`/`onAgentStatus`/`onEvent` de
`connectSessionHeartbeat` — um único `useEffect`, mas uma superfície de
escrita tão real quanto qualquer handler), o callback do
`StructuredQuestionCard` (`onTurnoIniciado`/`onTurnoTerminado`, ligado a
`AnswerStructuredQuestionUseCase`) e `handleReturnStory` (RN-174,
`ReturnStoryUseCase` → `reviseStory` no `po_server`) — que o ADR 0122 nunca
mencionou, embora já chamasse `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente`
corretamente na época.

O PR de deduplicação mecânica que precede este (já mergeado) fechou uma
segunda lacuna achada na mesma passada: `iniciarTurnoDoAgente`/
`finalizarTurnoDoAgente` já existiam como um par completo de `useCallback`,
mas só dois dos sete pontos de entrada os chamavam — `handleSend`,
`handleReadiness` e `handleArchitectureReadiness` duplicavam cada um o mesmo
arme de cinco linhas inline em vez de chamar a função existente. Aquele PR
trocou as três duplicatas por chamadas a `iniciarTurnoDoAgente` (que ganhou
ali o parâmetro `{ comStatus }` — ver Decisão abaixo) e introduziu
`cancelarTurnoOtimista`. O PR deste ADR é a segunda metade: mover o estado já
deduplicado, o efeito do canal e as três funções de ciclo de vida de
`SessionPage.tsx` para um hook.

## Decisão

Módulo novo `apps/web/src/lib/session-turno.ts`, exportando um hook:

```ts
function useTurnoDoAgente(
  projectId: string,
  sessionId: string,
  sessionStatus: string | undefined,
  queryClient: QueryClient,
) {
  return {
    // reads
    streaming, streamingText, streamingAgent, turnoViaCanal, statusAgent,
    pensandoVisivel, atividadeDoTurno, optimisticUser,
    // imperative API
    iniciarTurnoDoAgente, finalizarTurnoDoAgente, cancelarTurnoOtimista,
    // raw setters/ref — two call sites, and only two
    setStreaming, setStreamingText, setOptimisticUser,
    setTurnoViaCanal, turnoAgentRef,
  };
}
```

Um objeto, não uma tupla — 13 campos; desestruturação posicional seria
ilegível e frágil a reordenação. `SessionPage.tsx` o chama uma vez, logo
depois da query `session` de que depende para `sessionStatus`, e desestrutura
cada campo com o mesmo nome que já tinha — todo ponto de leitura do JSX, todo
corpo de handler e o gate de `refetchInterval` de `useSessionEvents` (que lê
`streaming`) continuam funcionando sem mudança.

Não há precedente neste código, antes deste, de um hook que seja dono de
estado e de uma API imperativa ao mesmo tempo: `useAutoCollapseSidebar`
(`lib/sidebar-state.ts`) devolve `void` — é só um efeito registrado.
`useSessionReadiness` (`lib/session-readiness.ts`, ADR 0122 PR 5) é uma função
pura de dois parâmetros, sem `useState`/efeito próprio. Nenhum dos dois é
modelo que este hook siga; dito explicitamente aqui em vez de insinuado como
"o padrão existente".

**Por que o efeito do canal se move inteiro.** O `useEffect` que chama
`connectSessionHeartbeat` é o sétimo ponto de entrada de escrita nomeado
acima, e foi conferido linha a linha como sendo 100% maquinário do ciclo de
vida do turno — até a antecipação de refetch do `onEvent` lê `streamingRef`
(uma peça deste mesmo agrupamento) para decidir se dispara. Nada no efeito
alcança fora do agrupamento, então ele se move com o array de dependências
completo, sem mudança.

**Por que `cancelarTurnoOtimista` cobre só duas das cinco formas com que este
arquivo desfaz um arme.** Existem cinco blocos diferentes de reset-em-falha
espalhados pelos handlers, em três formas diferentes, não uma forma repetida
cinco vezes:

1. A pré-checagem de `handleSend` (`startAgent('criativo')` falhando antes de
   o agente sequer ser conhecido): 2 campos (`streaming`, `optimisticUser`) —
   nunca armou o resto. Fica como duas chamadas cruas de `setState` em
   `SessionPage.tsx`, usando os `setStreaming`/`setOptimisticUser` que o hook
   expõe exatamente para isso.
2. O ramo de agente de `handleSend`: os 4 campos do arme completo mais
   `optimisticUser`, que o próprio arme nunca toca (ele é definido
   incondicionalmente no topo de `handleSend`, antes de o agente sequer ser
   resolvido). Vira `cancelarTurnoOtimista(); setOptimisticUser(null);` — duas
   chamadas, não uma função maior, porque o ciclo de vida de `optimisticUser`
   pertence a `handleSend`, não ao par armar/desarmar.
3. `handleReadiness`: 4 campos (`streaming`, `turnoAgentRef`, `statusAgent`,
   `turnoViaCanal`) — exatamente o que `cancelarTurnoOtimista` cobre.
4. `handleArchitectureReadiness`: um bloco IDÊNTICO ao de `handleReadiness` —
   mesma cobertura.
5. `handleAcceptHandoff`: 2 campos (`turnoAgentRef`, `turnoViaCanal`) — ele
   nunca arma `streaming`/`statusAgent`, para começar, porque o kickoff dele é
   um `GenServer.cast` assíncrono no engine (achado B): o handler ainda não
   sabe, na hora do clique, que um turno real vai começar, só quem vai
   responder. Chamar `cancelarTurnoOtimista` aqui acoplaria em silêncio um
   handler que nunca tocou `streaming`/`statusAgent` a uma função cujo nome
   promete desfazer os dois — a mesma armadilha que o ADR 0122 já apontou
   para o agrupamento como um todo. Este bloco fica inline em
   `handleAcceptHandoff`, exatamente como sempre esteve, usando os
   `setTurnoViaCanal`/`turnoAgentRef` que o hook expõe para este único ponto
   de chamada.

`cancelarTurnoOtimista` é feita para cobrir exatamente o #3 e o #4 — os dois
blocos idênticos — e nada mais. Uma sexta função para cobrir também o #5 foi
considerada e recusada: ela existiria para um chamador, duplicando o que duas
operações cruas já dizem diretamente.

**Por que dois PRs, não um.** A deduplicação mecânica (três armes duplicados
trocados por chamadas ao `iniciarTurnoDoAgente` preexistente, os dois blocos
de falha idênticos trocados pelo novo `cancelarTurnoOtimista`) e a extração do
módulo (estado, efeito do canal e as três funções realocados para
`lib/session-turno.ts`) são tipos diferentes de risco. O primeiro é "isto é,
chamada por chamada, o mesmo que as cinco linhas que substitui", revisável no
diff em minutos. O segundo é "as closures sobre `queryClient`/`projectId`/
`sessionId` e os arrays de dependência dos efeitos sobrevivem a uma mudança de
escopo de módulo", que precisava ser conferido sozinho, sem disputar atenção
com "esta versão do arme é sutilmente diferente daquela". O primeiro PR foi
mergeado antes de o segundo começar.

## Consequências

- `SessionPage.tsx` vai de 2 681 para 2 479 linhas (`wc -l`) — as declarações
  de estado, os `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente`/
  `cancelarTurnoOtimista` documentados com JSDoc, o efeito do canal e o efeito
  de armar/desarmar `pensandoVisivel` vão todos para `lib/session-turno.ts`
  (341 linhas, comentários incluídos — a mesma densidade do que substitui,
  porque o raciocínio que justificava cada campo e cada ramo se moveu com o
  código, não só o código).
- **Isto fecha o item do agrupamento do canal de turno que a seção
  "Explicitamente fora de escopo" do ADR 0122 adiou**, especificamente.
  `ProjectSettingsTab.tsx` — o outro arquivo nomeado na mesma linha de dívida
  técnica que `SessionPage.tsx` — não é afetado por este ADR e continua uma
  decisão de escopo totalmente separada, ainda aberta, sem data; nada aqui
  muda o estado dela.
- Os nove testes nomeados como cobertura de regressão deste agrupamento
  (`SessionPage.pista-e-status`, `.cancelar-turno`, `.turno-preso`,
  `.readiness-turno-preso`, `.handoff-devlead-e-colapso`,
  `.ideacao-automatica`, `.arquiteto-modelo-icone`, `.agente-mais-recente`,
  `.promocao-inline-e-volta` — o último é o único arquivo que cobre
  `handleReturnStory`/RN-174, que o ADR 0122 nunca nomeou) passam todos sem
  edição, junto com a suíte inteira de `SessionPage.*.test.tsx`, provando que
  a mudança não alterou nenhum comportamento observável.
- O achado das cinco formas acima (Decisão, "por que `cancelarTurnoOtimista`
  cobre só duas das cinco") agora está escrito uma vez, aqui, em vez de viver
  só em comentários de código — uma mudança futura em qualquer um dos cinco
  blocos de reset tem este ADR como referência de por que eles não são a
  mesma função hoje.

## Alternativas descartadas

- **Uma sexta função cobrindo o reset de 2 campos de `handleAcceptHandoff`
  (bloco #5 acima)**, para que todo handler chamasse uma função nomeada em vez
  de duas operações cruas. Recusada: ela teria exatamente um chamador, e as
  duas linhas que embrulharia (`turnoAgentRef.current = null;
  setTurnoViaCanal(false);`) já dizem o que fazem sem um nome intermediário
  para procurar.
- **Alargar `cancelarTurnoOtimista` para também resetar `atividadeDoTurno`**,
  na teoria de que um turno que falhou deveria sempre limpar a faixa de
  atividade. Recusada: nenhum dos três caminhos de falha dependentes de
  `await` (`handleReadiness`, `handleArchitectureReadiness`, o ramo de agente
  de `handleSend`) reseta `atividadeDoTurno` hoje, embora a chamada possa levar
  até 120s e deltas/tool-calls do canal possam já ter alimentado o reducer
  nesse meio-tempo. Essa é uma lacuna aceita no código como estava antes deste
  ADR, não algo que esta extração foi chamada a corrigir — acrescentar um novo
  `dispatchAtividade({ tipo: 'reset' })` aqui seria uma mudança de
  comportamento silenciosa de carona numa mudança que não deveria ter nenhuma.
- **Um PR em vez de dois.** Recusada pela razão dada em Decisão acima: a
  deduplicação e a mudança de módulo são tipos diferentes de risco, e
  misturá-las teria tornado mais difícil isolar uma regressão em qualquer uma
  das duas na revisão.

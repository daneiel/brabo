import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { connectSessionHeartbeat } from './session-channel';
import {
  ESTADO_INICIAL_DA_ATIVIDADE,
  reduzirAtividadeDoTurno,
  type EstadoDaAtividadeDoTurno,
} from './atividade-do-turno';
import { fraseDaFerramenta } from './narracao-de-ferramentas';

/**
 * O cluster de estado do CANAL DE TURNO de `SessionPage.tsx` — deixado de
 * fora, de propósito, da decomposição mecânica em 5 PRs (ADR 0122): "não é
 * um subtree de JSX contíguo nem um conjunto de funções puras; é controle
 * de fluxo entrelaçado". Esta é a ADR própria, numerada à parte (ADR 0124),
 * que aquele texto previu.
 *
 * `iniciarTurnoDoAgente`/`finalizarTurnoDoAgente` já eram um par
 * `useCallback` pronto antes desta extração (PR A deste mesmo esforço, já
 * mergeada) — dedup mecânica dos três chamadores que armavam o mesmo bloco
 * de 5 linhas inline. `cancelarTurnoOtimista` também nasceu ali. Esta PR
 * (B) move o trio, o estado que os dois primeiros já fechavam sobre, e o
 * efeito do canal Phoenix — que é o SÉTIMO ponto de escrita deste cluster,
 * 100% maquinário de ciclo de vida de turno — para este módulo, atrás de um
 * hook.
 *
 * Não existe precedente de hook com estado + API imperativa neste código
 * antes deste (`useAutoCollapseSidebar`, removido depois pelo ADR 0126,
 * devolvia `void`; `useSessionReadiness`
 * é função pura de dois parâmetros, sem `useState`/efeito nenhum) — dito
 * aqui explicitamente, não fingido como "seguindo um padrão que já existe".
 *
 * **Por que `cancelarTurnoOtimista` cobre só duas das cinco formas de
 * "desfazer o arme" que existem no chamador:** existem cinco blocos de
 * reset-em-falha em `SessionPage.tsx`, com formatos DIFERENTES:
 * 1. `handleSend`, pré-checagem de `startAgent('criativo')`: 2 campos
 *    (`streaming`, `optimisticUser`) — nunca armou o resto. Fica com dois
 *    `setState` crus no chamador, usando os setters expostos abaixo.
 * 2. `handleSend`, ramo do agente: os 4 campos do arm completo +
 *    `optimisticUser`, que o arm nunca toca (é setado incondicionalmente no
 *    topo da função). Vira `cancelarTurnoOtimista(); setOptimisticUser(null);`
 *    no chamador — duas chamadas, porque `optimisticUser` pertence ao
 *    ciclo de vida de `handleSend`, não ao par arme/desarme.
 * 3. `handleReadiness`: 4 campos (`streaming`, `turnoAgentRef`,
 *    `statusAgent`, `turnoViaCanal`) — exatamente o que `cancelarTurnoOtimista`
 *    cobre.
 * 4. `handleArchitectureReadiness`: bloco IDÊNTICO ao de `handleReadiness`
 *    — mesma cobertura.
 * 5. `handleAcceptHandoff`: 2 campos (`turnoAgentRef`, `turnoViaCanal`) —
 *    nunca armou `streaming`/`statusAgent` (o kickoff ali é um
 *    `GenServer.cast` ASSÍNCRONO no engine — achado B, ver o comentário de
 *    `turnoAgentRef` abaixo — então o handler nem sabe, na hora do clique,
 *    que os dois vão ser tocados). Chamar `cancelarTurnoOtimista` aqui
 *    acoplaria em silêncio um handler que nunca tocou `streaming`/
 *    `statusAgent` a uma função cujo nome promete desfazer os dois — a
 *    MESMA armadilha que a ADR 0122 já apontou. Por isso este bloco fica
 *    inline no chamador, como sempre esteve, usando `setTurnoViaCanal` e
 *    `turnoAgentRef` expostos abaixo — não uma sexta função nova.
 *
 * Nenhum dos três caminhos que dependem de `await` de chamada ao engine
 * (`handleReadiness`, `handleArchitectureReadiness`, o ramo de agente do
 * `handleSend`) reseta `atividadeDoTurno` em caso de falha — mesmo a
 * chamada podendo levar até 120s e deltas/tool-calls do canal já terem
 * alimentado o reducer nesse meio-tempo. Isto é lacuna aceita do código
 * ATUAL, preservada tal como estava: nenhum `dispatchAtividade({tipo:
 * 'reset'})` novo foi acrescentado em `cancelarTurnoOtimista` "ajudando" a
 * corrigir o que não foi pedido.
 */
export function useTurnoDoAgente(
  projectId: string,
  sessionId: string,
  sessionStatus: string | undefined,
  queryClient: QueryClient,
) {
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  // QUEM está falando (achado C). O delta passou a carregar o agente; sem ele
  // a tela rotulava a bolha com o nome do MODELO, que é detalhe de execução.
  const [streamingAgent, setStreamingAgent] = useState<string | null>(null);
  // A faixa de atividade do turno (`TurnActivityStrip.tsx`) — narração em
  // tempo real do que um agente conversacional está fazendo, substituindo a
  // bolha de streaming NO FIO para esse caso (a bolha continua existindo só
  // pro chat consultivo sem agente ativo, via SSE — ver `turnoViaCanal`
  // abaixo). Reducer PURO (`lib/atividade-do-turno.ts`), testado sem
  // React nenhum.
  const [atividadeDoTurno, dispatchAtividade] = useReducer(
    reduzirAtividadeDoTurno,
    ESTADO_INICIAL_DA_ATIVIDADE,
  );
  // O turno em curso é via CANAL do agente (Criativo/PO/Arquiteto/Dev Lead/UX
  // Designer/Staff), e não o chat consultivo sem agente ativo (SSE genérico,
  // `streamChatMessage`)? É esta flag — nunca `streaming`/`statusAgent`
  // sozinhos — que decide se a faixa (`TurnActivityStrip`) aparece OU a
  // bolha antiga: os dois streams compartilham `streaming`, e `statusAgent`/
  // `streamingAgent` passam por janelas legitimamente `null` NO MEIO de um
  // turno de agente (ex.: delta sem `agent` no payload). Ligada em TODO
  // ponto de entrada de turno de agente (handleSend, handleReadiness,
  // handleArchitectureReadiness, handleAcceptHandoff, `iniciarTurnoDoAgente`)
  // e desligada só por `finalizarTurnoDoAgente` — o ÚNICO lugar que finaliza
  // um turno.
  const [turnoViaCanal, setTurnoViaCanal] = useState(false);
  // Espelho do `streaming` para os handlers do canal: eles são registrados uma
  // vez e enxergariam sempre o valor inicial do state.
  const streamingRef = useRef(false);
  // Achado B: o engine avisa "comecei a trabalhar" (`agent.status` "working")
  // bem antes do primeiro delta — handoff aceito dispara um kickoff
  // ASSÍNCRONO (`GenServer.cast`) no engine, ao contrário de handleSend/
  // handleReadiness, que são síncronos e já ligam `streaming` na hora. Sem
  // isto, entre aceitar o handoff e o agente responder a tela não mostra
  // nada — só o silêncio, que é indistinguível de "não vai acontecer nada".
  //
  // `turnoAgentRef` guarda QUEM está prestes a responder, fixado no clique
  // que disparou o turno (`handleAcceptHandoff`) — não no roster derivado dos
  // eventos (`activeAgent`), que só reflete o `agent.activated` persistido
  // depois de um round-trip e podia perder a corrida com o broadcast do
  // canal, que é bem mais rápido.
  const turnoAgentRef = useRef<string | null>(null);
  // Agente identificado pelo `agent.status` "working" enquanto NENHUM delta
  // chegou ainda pra este turno. `null` assim que o primeiro delta chega (o
  // bloco de streaming já cobre) ou o turno termina.
  const [statusAgent, setStatusAgent] = useState<string | null>(null);
  // Indicador de "pensando" (bolha com os 3 pontinhos, RN-131) — só liga
  // depois de 5s SEM nenhum texto chegar, e não no instante em que o turno
  // começa. Antes ele piscava em toda mensagem, mesmo nas que respondiam em
  // menos de um segundo — ruído visual pra maioria dos turnos, que é o efeito
  // contrário do que um indicador de espera deveria ter. Ver o efeito que
  // arma/desarma o timer, logo abaixo.
  const [pensandoVisivel, setPensandoVisivel] = useState(false);
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);

  /**
   * RN-174 — arma o indicador de turno em curso a partir de uma ação que NÃO
   * é o composer.
   *
   * O indicador de "pensando" (RN-131/156) só aparece enquanto
   * `streaming || statusAgent` vale, e os dois eram ligados em três lugares:
   * `handleSend`, `handleReadiness`/`handleArchitectureReadiness` (que os
   * ligam na mão) e o canal Phoenix (`agent.delta`/`agent.status`). Só que
   * OUTRAS ações da tela também disparam um turno de agente síncrono no
   * engine — responder o formulário de perguntas estruturadas
   * (`AnswerStructuredQuestionUseCase` reusa `SendAgentMessageUseCase`) e
   * devolver uma história ao PO (`ReturnStoryUseCase` chama `reviseStory`,
   * que é `handle_call({:revise, …})` no `po_server`). Nesses dois caminhos
   * nenhum dos dois estados era ligado, e o canal não cobre o buraco: quando
   * ele ainda não terminou de conectar (ticket + join, RN-108) o
   * `agent.status` "working" se perde, e a tela fica em SILÊNCIO absoluto por
   * dezenas de segundos — que é exatamente o relato ("a web deve apresentar
   * uma animação mostrando que o agente está pensando").
   *
   * Quem chama é responsável por chamar `finalizarTurnoDoAgente` no fim (o
   * `finally` da própria ação), pelo mesmo argumento do `handleSend`: a
   * chamada RESOLVER é sinal de fim de turno tão confiável quanto o
   * `agent.done` do canal, e a função é idempotente.
   *
   * `comStatus` (default `true`) existe só para `handleAcceptHandoff`: o
   * kickoff do agente ali é um `GenServer.cast` ASSÍNCRONO no engine (achado
   * B, ver o comentário do `turnoAgentRef` acima), então o handler não sabe,
   * na hora do clique, que um turno de verdade vai começar — só sabe QUEM vai
   * responder. `comStatus: false` reduz o arme a `turnoAgentRef`+
   * `turnoViaCanal` (o par que `handleAcceptHandoff` sempre armou sozinho):
   * `streaming`/`streamingText`/`statusAgent` ficam de fora, porque os três
   * juntos (via `streaming || statusAgent`) são o que arma o timer de 5s do
   * indicador de "pensando" (RN-131) — ligar qualquer um deles cedo demais
   * reativaria esse timer mesmo depois de o `onAgentStatus` do canal já ter
   * avisado `idle` (turno mais rápido que 5s, sem nunca ter mostrado nada).
   * Os três chegam depois, pelo `onAgentStatus`/`onAgentDelta` do canal. Todo
   * outro chamador dispara um `GenServer.call` SÍNCRONO, já sabe que o turno
   * começou e usa o default.
   */
  const iniciarTurnoDoAgente = useCallback(
    (agente: string | null, { comStatus = true }: { comStatus?: boolean } = {}) => {
      // Fixado ANTES do `await` de quem chama (mesmo motivo do achado B em
      // `handleAcceptHandoff`): o `agent.status` do canal pode chegar primeiro,
      // e sem o ref o indicador nasceria sem saber quem está falando.
      turnoAgentRef.current = agente;
      setTurnoViaCanal(true);
      if (comStatus) {
        setStreaming(true);
        setStreamingText('');
        // `statusAgent` é o que dá NOME ao indicador antes do primeiro delta.
        // `streaming` sozinho já o faria aparecer, mas como "agente" genérico.
        setStatusAgent(agente);
      }
    },
    [],
  );

  // Reconciliação de fim de turno do `activeAgent` — o que `onAgentDone` (canal)
  // faz, extraído pra também servir de REDE DE SEGURANÇA em `handleSend` (ver
  // `SessionPage.tsx`). Idempotente: chamar duas vezes pro mesmo turno (canal E
  // fallback) só reseta estado que já estava resetado e invalida query que já
  // está fresca.
  const finalizarTurnoDoAgente = useCallback(() => {
    streamingRef.current = false;
    setStreaming(false);
    setStreamingText('');
    setStreamingAgent(null);
    setOptimisticUser(null);
    // Fim do turno também encerra o indicador de "comecei a trabalhar"
    // (achado B) — senão ele sobrevive a um turno que nunca chegou a
    // streamar texto nenhum (só ferramentas, por exemplo).
    turnoAgentRef.current = null;
    setStatusAgent(null);
    // A faixa de atividade: sai de cena (o fio já vai ganhar a bolha
    // definitiva assim que a invalidação abaixo trouxer o `agent.response`
    // persistido) e o reducer volta ao estado vazio — ÚNICO ponto de reset,
    // pelo mesmo argumento do resto desta função.
    setTurnoViaCanal(false);
    dispatchAtividade({ tipo: 'reset' });
    queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-handoffs', projectId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-budget', projectId, sessionId] });
  }, [queryClient, projectId, sessionId]);

  // Desfaz um arme otimista que falhou (`handleReadiness`/
  // `handleArchitectureReadiness`, nos dois `catch` de `SessionPage.tsx`): os
  // mesmos 4 campos que os dois ligam antes do `await` síncrono no engine, e
  // nenhum outro. NÃO cobre `handleAcceptHandoff` — que nunca arma `streaming`/
  // `statusAgent` (achado B), então chamar esta função ali acoplaria em
  // silêncio um handler que nunca tocou os dois campos a uma função cujo
  // nome promete desfazer os dois — a mesma armadilha que a ADR 0122 já
  // apontou. Também não cobre `handleSend`, que tem `optimisticUser` como
  // quinto campo (fora do arme, setado incondicionalmente no topo da
  // função) — esse handler chama esta função MAIS `setOptimisticUser(null)`
  // em separado, porque o ciclo de vida de `optimisticUser` é dele, não do
  // par arme/desarme.
  const cancelarTurnoOtimista = useCallback(() => {
    setStreaming(false);
    setTurnoViaCanal(false);
    turnoAgentRef.current = null;
    setStatusAgent(null);
  }, []);

  // Canal Phoenix: recebe os deltas do Criativo (streaming token-a-token) e o
  // fim do turno. A persistência (agent.response + artefatos) chega pelo poll.
  useEffect(() => {
    if (sessionStatus !== 'active') return;
    const disconnect = connectSessionHeartbeat(projectId, sessionId, {
      onAgentDelta: (text, agent) => {
        streamingRef.current = true;
        setStreaming(true);
        // Redirecionado pro reducer da faixa de atividade — `streamingText`
        // continua existindo, mas só o chat consultivo sem agente ativo
        // (SSE, `streamChatMessage`) ainda escreve nele. Defensivo: liga
        // `turnoViaCanal` aqui também, caso o delta chegue antes de
        // qualquer um dos pontos de entrada acima tê-lo ligado.
        setTurnoViaCanal(true);
        dispatchAtividade({ tipo: 'delta', texto: text });
        if (agent) setStreamingAgent(agent);
        // O delta é o streaming de verdade — o indicador de "comecei a
        // trabalhar" (achado B) já cumpriu o papel dele.
        setStatusAgent(null);
      },
      onToolCall: (tool) => {
        setTurnoViaCanal(true);
        dispatchAtividade({ tipo: 'tool_call', frase: fraseDaFerramenta(tool) });
      },
      onAgentDone: finalizarTurnoDoAgente,
      // Achado B: `agent.status` "working" chega bem antes do primeiro
      // delta quando o turno é disparado por um kickoff ASSÍNCRONO no engine
      // (handoff aceito, `GenServer.cast`) — ao contrário de handleSend/
      // handleReadiness, que já ligam `streaming` na hora por serem
      // síncronos. Só vira indicador se NENHUM delta chegou ainda pra este
      // turno (`streamingRef`); senão o bloco de streaming já cobre.
      onAgentStatus: (payload) => {
        if (payload.status === 'working') {
          if (!streamingRef.current) setStatusAgent(turnoAgentRef.current);
        } else {
          setStatusAgent(null);
        }
      },
      // Fase 4a — painel do time ao vivo: qualquer evento persistido
      // (Dev/QA/SecOps/Infra) antecipa o refetch do polling — reaproveita o
      // parsing/cache já existente (useSessionEvents), só antecipa quando o
      // dado muda em vez de esperar o intervalo do poll.
      // Enquanto um turno conversacional está streamando, NÃO antecipa o
      // refetch: a bolha ao vivo é uma prévia do `agent.response` que está para
      // ser persistido, e trazer o evento antes de `agent.done` põe as duas na
      // tela ao mesmo tempo — a duplicação do achado C. `onAgentDone` invalida
      // logo em seguida, então nada se perde; só deixa de aparecer duas vezes.
      onEvent: () => {
        if (streamingRef.current) return;
        queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      },
    });
    return disconnect;
  }, [sessionStatus, sessionId, projectId, queryClient, finalizarTurnoDoAgente]);

  // Arma/desarma o timer de 5s do indicador de "pensando" (RN-131) — o MESMO
  // timer que a faixa de atividade (`TurnActivityStrip`) reusa pro seu
  // próprio "Pensando…", via a prop `pensandoVisivel`. Só conta o tempo
  // enquanto há turno em curso (`streaming`/`statusAgent`) E NENHUM conteúdo
  // chegou ainda — nem pelo caminho antigo (`streamingText`, SSE) nem pelo
  // novo (o reducer da faixa, `atividadeDoTurno`): os dois viram `false` de
  // novo assim que qualquer um deixa de valer — conteúdo chegando (streaming
  // REAL não espera nada, aparece na hora) ou o turno terminando antes dos 5s
  // (a resposta foi rápida, e o indicador nunca deveria ter existido). O
  // timer é cancelado no cleanup do próprio efeito sempre que uma dessas
  // dependências muda, então nunca liga `pensandoVisivel` depois do fato.
  const semConteudoNoTurno =
    !streamingText && !atividadeDoTurno.corrente && atividadeDoTurno.linhas.length === 0;
  useEffect(() => {
    if (!(streaming || statusAgent) || !semConteudoNoTurno) {
      setPensandoVisivel(false);
      return;
    }
    const timer = setTimeout(() => setPensandoVisivel(true), 5000);
    return () => clearTimeout(timer);
  }, [streaming, statusAgent, semConteudoNoTurno]);

  return {
    // leituras
    streaming,
    streamingText,
    streamingAgent,
    turnoViaCanal,
    statusAgent,
    pensandoVisivel,
    atividadeDoTurno,
    optimisticUser,
    // API imperativa
    iniciarTurnoDoAgente,
    finalizarTurnoDoAgente,
    cancelarTurnoOtimista,
    // setters/ref crus — dois consumidores, e só estes dois:
    // - `setStreaming`/`setStreamingText`/`setOptimisticUser`: o ramo
    //   SSE-fallback de `handleSend` (chat consultivo sem agente ativo),
    //   que nunca toca `turnoViaCanal`/`statusAgent`/`atividadeDoTurno`.
    // - `setTurnoViaCanal`/`turnoAgentRef`: o `catch` de `handleAcceptHandoff`
    //   (bloco #5 acima) — os 2 campos que ele sempre desfez sozinho, sem
    //   passar por `cancelarTurnoOtimista` (que tocaria 2 campos que ele
    //   nunca armou).
    setStreaming,
    setStreamingText,
    setOptimisticUser,
    setTurnoViaCanal,
    turnoAgentRef,
  };
}

export type UseTurnoDoAgenteResult = ReturnType<typeof useTurnoDoAgente>;
export type { EstadoDaAtividadeDoTurno };

import { Socket } from 'phoenix';
import { logger } from './logger';
import { runtimeConfig } from './runtime-config';
import { createSocketTicket } from './api-client';

const ENGINE_URL = runtimeConfig.engineUrl;
const PING_INTERVAL_MS = 10_000;

// RN-108: o `EngineWeb.SessionSocket.connect/3` do engine agora exige um
// ticket opaco de uso único (TTL de 30s) — sem ele a conexão inteira é
// recusada, não só o join do canal. O reconnect AUTOMÁTICO embutido do
// `Phoenix.Socket` reusaria o MESMO objeto `params` da construção, e como o
// ticket é de uso único e expira em 30s, essa reconexão embutida SEMPRE
// falharia. Por isso ele é neutralizado (`reconnectAfterMs` que praticamente
// nunca dispara) e a reconexão inteira passa a ser MANUAL, daqui: cada
// tentativa — inclusive a primeira — busca um ticket NOVO antes de
// `socket.connect()`.
const NUNCA_RECONECTAR_SOZINHO_MS = 24 * 60 * 60 * 1000;

/** Backoff da reconexão MANUAL — mesma forma do rejoin nativo do Phoenix. */
function esperaDaTentativa(tentativa: number): number {
  return [1_000, 2_000, 5_000][tentativa - 1] ?? 10_000;
}

export interface SessionChannelHandlers {
  // Deltas token-a-token da resposta de um agente conversacional (Criativo,
  // PO, Arquiteto, Infra), rebroadcastados pelo server do agente (Fase 3b).
  //
  // `agent` viaja junto desde o achado C: sem ele a tela não tinha como saber
  // QUEM estava falando e rotulava a bolha com o nome do modelo. É opcional
  // porque um engine anterior a esta mudança não o envia — nesse caso a tela
  // degrada para "agente", nunca para o nome do modelo.
  onAgentDelta?: (text: string, agent?: string) => void;
  // Fim de um turno do agente — hora de reconciliar com o event log.
  onAgentDone?: () => void;
  // Working/idle nos limites de turno dos agentes conversacionais
  // (criativo/po/arquiteto/infra) — Fase 4a, painel do time ao vivo.
  onAgentStatus?: (payload: { status: 'working' | 'idle' }) => void;
  // Qualquer session_event recém-persistido (Dev/QA/SecOps/Infra, Fase 4a) —
  // broadcastado ao lado do append_event no engine. Usado só como GATILHO
  // pra antecipar o refetch do polling (nunca substitui o parsing/cache do
  // GET .../events já existente).
  onEvent?: (payload: { type: string; actorId: string; payload: unknown }) => void;
  // Ferramenta chamada durante um turno de agente conversacional — broadcast
  // efêmero (faixa de atividade da sessão), rebroadcastado pelo server do
  // agente logo depois do `tool.call` durável (ver os seis servers em
  // `apps/engine/lib/engine/agents/*_server.ex`). Sem `args`: o payload cru
  // da ferramenta nunca viaja pro cliente (RN-096) — quem consome resolve a
  // frase por `fraseDaFerramenta(tool)`.
  onToolCall?: (tool: string, agent?: string) => void;
}

/**
 * Canal Phoenix `session:<id>` — mantém a sessão viva (heartbeat) e, na Fase
 * 3b, recebe o push de `agent.delta`/`agent.done` do CriativoServer pra
 * exibir a resposta do agente streamando. A persistência final (agent.response
 * + artefatos) continua chegando pelo polling de GET .../events.
 *
 * `projectId` entrou com a RN-108: é ele que autoriza o pedido do ticket
 * (`POST /projects/:projectId/sessions/:sessionId/socket-ticket`, que já
 * checa papel efetivo — a rota exige pelo menos `viewer`).
 */
export function connectSessionHeartbeat(
  projectId: string,
  sessionId: string,
  handlers: SessionChannelHandlers = {},
): () => void {
  const wsUrl = ENGINE_URL.replace(/^http/, 'ws') + '/socket';

  let socket: Socket | null = null;
  let channel: ReturnType<Socket['channel']> | null = null;
  let pingInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let parado = false;
  let tentativa = 0;

  function limparPing() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  function agendarReconexao() {
    if (parado) return;
    tentativa += 1;
    const espera = esperaDaTentativa(tentativa);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void conectar();
    }, espera);
  }

  async function conectar() {
    if (parado) return;

    let ticket: string;
    try {
      const emitido = await createSocketTicket(projectId, sessionId, 'heartbeat');
      ticket = emitido.ticket;
    } catch (erro) {
      logger.warn('não consegui obter ticket do socket da sessão', {
        sessionId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      agendarReconexao();
      return;
    }

    if (parado) return;

    socket = new Socket(wsUrl, {
      params: { ticket },
      reconnectAfterMs: () => NUNCA_RECONECTAR_SOZINHO_MS,
    });

    // O ciclo de vida do socket não era observado (ADR 0035): `onError` e
    // `onClose` nunca eram registrados, e a única linha era um `console.warn`
    // cru — o último do app. Consequência: o painel ao vivo parar de
    // atualizar era indistinguível de "não há nada acontecendo".
    //
    // Sem `trace_id` aqui, de propósito: o socket é longo e não corresponde a
    // uma ação do usuário, e o canal do Phoenix não passa pelo
    // `OpentelemetryBandit` — um id inventado aqui não teria par nenhum do
    // lado do servidor. Quem correlaciona é o `sessionId`, que é o mesmo que
    // o engine agora emite em `Logger.metadata(session_id:)`.
    socket.onError((erro: unknown) =>
      logger.warn('socket da sessão com erro', {
        sessionId,
        erro: String(erro),
      }),
    );
    socket.onClose(() => {
      logger.info('socket da sessão fechado', { sessionId });
      limparPing();
      // Reconexão MANUAL — busca ticket novo, nunca reusa o que acabou de
      // cair. `parado` cobre o cleanup intencional (retorno desta função).
      agendarReconexao();
    });
    socket.onOpen(() => {
      // Conexão bem-sucedida: a próxima queda volta a contar do começo do
      // backoff, em vez de continuar de onde a instabilidade anterior parou.
      tentativa = 0;
    });

    socket.connect();

    const canal = socket.channel(`session:${sessionId}`, {});
    channel = canal;
    canal
      .join()
      .receive('error', (resp: unknown) =>
        logger.warn('não foi possível entrar no canal da sessão', {
          sessionId,
          resp,
        }),
      )
      .receive('timeout', () =>
        logger.warn('timeout ao entrar no canal da sessão', { sessionId }),
      );

    if (handlers.onAgentDelta) {
      canal.on('agent.delta', (payload: { text?: string; agent?: string }) => {
        if (typeof payload?.text === 'string') {
          handlers.onAgentDelta!(
            payload.text,
            typeof payload.agent === 'string' ? payload.agent : undefined,
          );
        }
      });
    }
    if (handlers.onAgentDone) {
      canal.on('agent.done', () => handlers.onAgentDone!());
    }
    if (handlers.onAgentStatus) {
      canal.on('agent.status', (payload: { status?: string }) => {
        if (payload?.status === 'working' || payload?.status === 'idle') {
          handlers.onAgentStatus!({ status: payload.status });
        }
      });
    }
    if (handlers.onToolCall) {
      canal.on('tool.call', (payload: { tool?: string; agent?: string }) => {
        if (typeof payload?.tool === 'string') {
          handlers.onToolCall!(
            payload.tool,
            typeof payload.agent === 'string' ? payload.agent : undefined,
          );
        }
      });
    }
    if (handlers.onEvent) {
      canal.on(
        'event.appended',
        (payload: { type?: string; actorId?: string; payload?: unknown }) => {
          if (typeof payload?.type === 'string') {
            handlers.onEvent!({
              type: payload.type,
              actorId: payload.actorId ?? '',
              payload: payload.payload,
            });
          }
        },
      );
    }

    pingInterval = setInterval(() => {
      if (canal.state === 'joined') canal.push('ping', {});
    }, PING_INTERVAL_MS);
  }

  void conectar();

  return () => {
    parado = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    limparPing();
    channel?.leave();
    socket?.disconnect();
  };
}

import { Socket } from 'phoenix';
import { logger } from './logger';
import { runtimeConfig } from './runtime-config';

const ENGINE_URL = runtimeConfig.engineUrl;
const PING_INTERVAL_MS = 10_000;

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
}

/**
 * Canal Phoenix `session:<id>` — mantém a sessão viva (heartbeat) e, na Fase
 * 3b, recebe o push de `agent.delta`/`agent.done` do CriativoServer pra
 * exibir a resposta do agente streamando. A persistência final (agent.response
 * + artefatos) continua chegando pelo polling de GET .../events.
 */
export function connectSessionHeartbeat(
  sessionId: string,
  handlers: SessionChannelHandlers = {},
): () => void {
  const wsUrl = ENGINE_URL.replace(/^http/, 'ws') + '/socket';
  const socket = new Socket(wsUrl);

  // O ciclo de vida do socket não era observado (ADR 0035): `onError` e `onClose`
  // nunca foram registrados, e a única linha era um `console.warn` cru — o último
  // do app. Consequência: o painel ao vivo parar de atualizar era indistinguível
  // de "não há nada acontecendo".
  //
  // Sem `trace_id` aqui, de propósito: o socket é longo e não corresponde a uma
  // ação do usuário, e o canal do Phoenix não passa pelo `OpentelemetryBandit` —
  // um id inventado aqui não teria par nenhum do lado do servidor. Quem
  // correlaciona é o `sessionId`, que é o mesmo que o engine agora emite em
  // `Logger.metadata(session_id:)`.
  socket.onError((erro: unknown) =>
    logger.warn('socket da sessão com erro', {
      sessionId,
      erro: String(erro),
    }),
  );
  socket.onClose(() => logger.info('socket da sessão fechado', { sessionId }));

  socket.connect();

  const channel = socket.channel(`session:${sessionId}`, {});
  channel
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
    channel.on('agent.delta', (payload: { text?: string; agent?: string }) => {
      if (typeof payload?.text === 'string') {
        handlers.onAgentDelta!(
          payload.text,
          typeof payload.agent === 'string' ? payload.agent : undefined,
        );
      }
    });
  }
  if (handlers.onAgentDone) {
    channel.on('agent.done', () => handlers.onAgentDone!());
  }
  if (handlers.onAgentStatus) {
    channel.on('agent.status', (payload: { status?: string }) => {
      if (payload?.status === 'working' || payload?.status === 'idle') {
        handlers.onAgentStatus!({ status: payload.status });
      }
    });
  }
  if (handlers.onEvent) {
    channel.on(
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

  const interval = setInterval(() => {
    if (channel.state === 'joined') channel.push('ping', {});
  }, PING_INTERVAL_MS);

  return () => {
    clearInterval(interval);
    channel.leave();
    socket.disconnect();
  };
}

import { Socket } from 'phoenix';

const ENGINE_URL = import.meta.env.VITE_ENGINE_URL ?? 'http://localhost:4000';
const PING_INTERVAL_MS = 10_000;

export interface SessionChannelHandlers {
  // Deltas token-a-token da resposta de um agente conversacional (Criativo),
  // rebroadcastados pelo CriativoServer (Fase 3b).
  onAgentDelta?: (text: string) => void;
  // Fim de um turno do agente — hora de reconciliar com o event log.
  onAgentDone?: () => void;
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
  socket.connect();

  const channel = socket.channel(`session:${sessionId}`, {});
  channel
    .join()
    .receive('error', (resp: unknown) =>
      console.warn('não foi possível entrar no canal da sessão', resp),
    );

  if (handlers.onAgentDelta) {
    channel.on('agent.delta', (payload: { text?: string }) => {
      if (typeof payload?.text === 'string') handlers.onAgentDelta!(payload.text);
    });
  }
  if (handlers.onAgentDone) {
    channel.on('agent.done', () => handlers.onAgentDone!());
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

import { Socket } from 'phoenix';

const ENGINE_URL = import.meta.env.VITE_ENGINE_URL ?? 'http://localhost:4000';
const PING_INTERVAL_MS = 10_000;

/**
 * Canal Phoenix `session:<id>` — hoje só serve pra manter a sessão viva
 * no engine (heartbeat), sem nenhum push de evento (ver
 * apps/engine/lib/engine_web/channels/session_channel.ex). O feed de
 * atividade/notificações usa polling em cima de
 * GET .../sessions/:id/events, papel completamente separado — ver
 * useActivityFeed.
 */
export function connectSessionHeartbeat(sessionId: string): () => void {
  const wsUrl = ENGINE_URL.replace(/^http/, 'ws') + '/socket';
  const socket = new Socket(wsUrl);
  socket.connect();

  const channel = socket.channel(`session:${sessionId}`, {});
  channel
    .join()
    .receive('error', (resp: unknown) =>
      console.warn('não foi possível entrar no canal da sessão', resp),
    );

  const interval = setInterval(() => {
    if (channel.state === 'joined') channel.push('ping', {});
  }, PING_INTERVAL_MS);

  return () => {
    clearInterval(interval);
    channel.leave();
    socket.disconnect();
  };
}

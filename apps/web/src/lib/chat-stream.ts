import { renovarSessao, tokenAtual } from './auth';
import { API_URL } from './api-client';
import type { ChatSseEvent } from './api-types';

/**
 * O endpoint de chat é `@Sse(..., { method: POST })` — EventSource não
 * faz POST, então lê o stream manualmente via fetch + ReadableStream.
 * Cada frame SSE é `data: {...}\n\n`; um frame pode conter múltiplas
 * linhas `data:` (não usado aqui, mas tratado por segurança).
 */
export async function* streamChatMessage(
  projectId: string,
  sessionId: string,
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatSseEvent> {
  // Garante um token antes de abrir o stream. Diferente das chamadas normais,
  // aqui não dá para "tentar e renovar no 401": a resposta é um corpo em
  // streaming e reabrir no meio perderia os frames já entregues.
  const token = tokenAtual() ?? (await renovarSessao());
  const res = await fetch(
    `${API_URL}/projects/${projectId}/sessions/${sessionId}/chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
      signal,
    },
  );

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    yield { type: 'error', message: `falha ao iniciar o chat: ${res.status} ${body}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) continue;

      try {
        yield JSON.parse(dataLines.join('')) as ChatSseEvent;
      } catch {
        // frame malformado — ignora, não derruba o stream inteiro.
      }
    }
  }
}

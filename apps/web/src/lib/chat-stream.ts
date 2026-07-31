import { renovarSessao, tokenAtual } from './auth';
import { API_URL } from './api-client';
import { logger, newTraceContext } from './logger';
import type { ChatSseEvent } from './api-types';

/**
 * O endpoint de chat é `@Sse(..., { method: POST })` — EventSource não
 * faz POST, então lê o stream manualmente via fetch + ReadableStream.
 * Cada frame SSE é `data: {...}\n\n`; um frame pode conter múltiplas
 * linhas `data:` (não usado aqui, mas tratado por segurança).
 *
 * ## Este caminho não passa pelo `api-client`
 *
 * E por isso ficou de fora de tudo o que o `request<T>` faz: até o ADR 0035 não
 * mandava `traceparent` (era o ÚNICO caminho da web sem trace, justamente o do
 * turno de LLM, o trabalho mais caro do sistema) e não logava nada — erro de
 * status ia em banda, frame malformado era descartado em silêncio, e falha de
 * rede virava rejeição não tratada do gerador.
 *
 * Continua fora de propósito: a resposta é um corpo em streaming e a
 * renovação-no-401 do `request<T>` perderia frames já entregues. O que se
 * corrigiu foi a observabilidade, não a estrutura.
 */
export async function* streamChatMessage(
  projectId: string,
  sessionId: string,
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatSseEvent> {
  // Mesma trace que a api adota como parent, igual ao `api-client`.
  const trace = newTraceContext();

  // Garante um token antes de abrir o stream. Diferente das chamadas normais,
  // aqui não dá para "tentar e renovar no 401": a resposta é um corpo em
  // streaming e reabrir no meio perderia os frames já entregues.
  const token = tokenAtual() ?? (await renovarSessao());

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}/projects/${projectId}/sessions/${sessionId}/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
          traceparent: trace.traceparent,
        },
        body: JSON.stringify({ text }),
        signal,
      },
    );
  } catch (erro) {
    // O `fetch` rejeitava para fora do gerador, sem log: uma api fora do ar no
    // meio de uma conversa aparecia como "nada aconteceu".
    //
    // `AbortError` não é falha: é o usuário saindo da tela ou trocando de sessão.
    if (erro instanceof Error && erro.name === 'AbortError') return;

    logger.errorWithTrace('stream de chat inalcançável', trace.traceId, {
      sessionId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    yield {
      type: 'error',
      message: 'não foi possível falar com a api',
    };
    return;
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    logger.errorWithTrace('falha ao iniciar o stream de chat', trace.traceId, {
      sessionId,
      status: res.status,
    });
    yield {
      type: 'error',
      message: `falha ao iniciar o chat: ${res.status} ${body}`,
    };
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
        // Segue descartando o frame — derrubar o stream inteiro por um frame
        // ruim seria pior. O que mudou é não descartar em SILÊNCIO: um frame
        // malformado significa que a api e a web discordam do formato, e isso
        // precisa aparecer em algum lugar.
        logger.warn('frame SSE malformado descartado', {
          trace_id: trace.traceId,
          sessionId,
        });
      }
    }
  }
}

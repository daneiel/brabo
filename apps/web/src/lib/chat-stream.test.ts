import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamChatMessage } from './chat-stream';

/**
 * O stream de chat (ADR 0035).
 *
 * A regressão que este arquivo existe para pegar: o chat era o ÚNICO caminho da
 * web que não propagava `traceparent`, porque contorna o `api-client.ts` inteiro.
 * E era o pior lugar possível para essa lacuna — é o turno de LLM, o trabalho
 * mais caro do sistema, e o único cuja latência o usuário vê acontecendo. O
 * `agent.turn` e o `llm.turn` do engine existiam no Tempo sem nada ligando a eles
 * a ação que os pediu.
 *
 * Os outros três casos são silêncios do mesmo arquivo: erro de status ia em banda
 * sem log, frame malformado era descartado calado, e falha de rede rejeitava para
 * fora do gerador.
 */

function respostaSse(frames: string[]): Response {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let i = 0;
        return {
          read: () =>
            Promise.resolve(
              i < frames.length
                ? { done: false, value: encoder.encode(frames[i++]) }
                : { done: true, value: undefined },
            ),
        };
      },
    },
  } as unknown as Response;
}

async function coletar(gerador: AsyncGenerator<unknown>) {
  const saida: unknown[] = [];
  for await (const evento of gerador) saida.push(evento);
  return saida;
}

/**
 * A chamada do CHAT, entre as do `fetch`.
 *
 * Sem token em memória, `streamChatMessage` chama `renovarSessao()` primeiro, que
 * faz o seu próprio `fetch` para `/auth/refresh` — então `calls[0]` não é o chat.
 * Selecionar por URL em vez de por índice também deixa o teste imune a uma
 * mudança nessa ordem.
 */
function chamadaDoChat(spy: { mock: { calls: unknown[][] } }) {
  const chamada = spy.mock.calls.find(([url]) =>
    String(url).includes('/chat'),
  );
  if (!chamada) throw new Error('o fetch do chat não aconteceu');
  return chamada as [string, RequestInit];
}

/** As linhas de `console.warn` cuja mensagem casa — ignora as do refresh. */
function avisos(mensagem: string): Record<string, unknown>[] {
  const spy = console.warn as unknown as { mock: { calls: string[][] } };
  return spy.mock.calls
    .map(([linha]) => JSON.parse(linha) as Record<string, unknown>)
    .filter((linha) => String(linha.message).includes(mensagem));
}

describe('streamChatMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('manda traceparent W3C no header', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(respostaSse(['data: {"type":"done"}\n\n']));
    vi.stubGlobal('fetch', fetchSpy);

    await coletar(streamChatMessage('p1', 's1', 'oi'));

    const [, init] = chamadaDoChat(fetchSpy);
    const headers = init.headers as Record<string, string>;
    expect(headers.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
    );
  });

  it('em resposta não-ok, rende erro em banda E loga com trace_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        body: null,
        text: () => Promise.resolve('indisponível'),
      } as unknown as Response),
    );

    const eventos = await coletar(streamChatMessage('p1', 's1', 'oi'));

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ type: 'error' });

    const linha = JSON.parse(
      (console.error as unknown as { mock: { calls: string[][] } }).mock
        .calls[0][0],
    ) as Record<string, unknown>;
    expect(linha.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(linha.status).toBe(503);
  });

  it('descarta frame malformado sem derrubar o stream, e avisa', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respostaSse(['data: {isso não é json}\n\n', 'data: {"type":"done"}\n\n']),
        ),
    );

    const eventos = await coletar(streamChatMessage('p1', 's1', 'oi'));

    // O frame bom depois do ruim ainda chega: descartar um frame não pode matar
    // a conversa.
    expect(eventos).toEqual([{ type: 'done' }]);

    const descartes = avisos('frame SSE malformado');
    expect(descartes).toHaveLength(1);
    expect(descartes[0].trace_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('falha de rede virá erro em banda, não rejeição solta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const eventos = await coletar(streamChatMessage('p1', 's1', 'oi'));

    expect(eventos).toEqual([
      { type: 'error', message: 'não foi possível falar com a api' },
    ]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('cancelamento pelo usuário não é erro e não loga', async () => {
    // Trocar de sessão ou sair da tela aborta o fetch. Tratar como falha
    // encheria o console de erro em uso normal.
    const abort = new Error('abortado');
    abort.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));

    const eventos = await coletar(streamChatMessage('p1', 's1', 'oi'));

    expect(eventos).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });
});

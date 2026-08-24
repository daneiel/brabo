import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * RN-108: `connectSessionHeartbeat` passou a buscar um ticket opaco de uso
 * único ANTES de todo `socket.connect()` — inclusive em reconexão automática,
 * que nunca pode reusar um ticket velho (TTL de 30s). `phoenix` e
 * `./api-client` são substituídos por dublês: não há WebSocket de verdade em
 * jsdom, e o que importa aqui é a ORQUESTRAÇÃO (busca o ticket, passa pro
 * socket, refaz tudo numa queda), não o transporte.
 */

// `vi.mock` é hoisted pro topo do arquivo — tudo que a factory usa precisa
// nascer dentro de `vi.hoisted`, senão é `ReferenceError` em runtime (a classe
// ainda não existiria no ponto em que o mock é registrado).
const { FakeSocket, fakeChannel, socketInstances, createSocketTicketMock } = vi.hoisted(
  () => {
    const fakeChannel = {
      join: vi.fn(),
      on: vi.fn(),
      push: vi.fn(),
      leave: vi.fn(),
      state: 'joined',
    };
    fakeChannel.join.mockReturnValue({
      receive: vi.fn().mockReturnValue({ receive: vi.fn() }),
    });

    const socketInstances: FakeSocket[] = [];

    class FakeSocket {
      url: string;
      opts: { params?: { ticket?: string }; reconnectAfterMs?: (t: number) => number };
      connect = vi.fn();
      disconnect = vi.fn();
      channel = vi.fn(() => fakeChannel);
      onOpen = vi.fn();
      onClose = vi.fn();
      onError = vi.fn();

      constructor(
        url: string,
        opts: { params?: { ticket?: string }; reconnectAfterMs?: (t: number) => number },
      ) {
        this.url = url;
        this.opts = opts;
        socketInstances.push(this);
      }
    }

    const createSocketTicketMock = vi.fn();

    return { FakeSocket, fakeChannel, socketInstances, createSocketTicketMock };
  },
);

vi.mock('phoenix', () => ({ Socket: FakeSocket }));

vi.mock('./api-client', () => ({
  createSocketTicket: (...args: unknown[]) => createSocketTicketMock(...args),
}));

vi.mock('./runtime-config', () => ({
  runtimeConfig: { engineUrl: 'http://engine.local' },
}));

vi.mock('./logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), errorWithTrace: vi.fn() },
}));

import { connectSessionHeartbeat } from './session-channel';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  socketInstances.length = 0;
  createSocketTicketMock.mockReset();
  fakeChannel.join.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectSessionHeartbeat (RN-108)', () => {
  it('caminho feliz: busca um ticket de escopo heartbeat ANTES de conectar', async () => {
    createSocketTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      expiresAt: new Date().toISOString(),
    });

    const disconnect = connectSessionHeartbeat('proj-1', 'sess-1', {});
    await flush();

    expect(createSocketTicketMock).toHaveBeenCalledWith('proj-1', 'sess-1', 'heartbeat');
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].opts.params).toEqual({ ticket: 'ticket-1' });
    expect(socketInstances[0].connect).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it('falha ao buscar o ticket: agenda nova tentativa em vez de travar', async () => {
    createSocketTicketMock
      .mockRejectedValueOnce(new Error('api fora do ar'))
      .mockResolvedValueOnce({ ticket: 'ticket-2', expiresAt: new Date().toISOString() });

    const disconnect = connectSessionHeartbeat('proj-1', 'sess-1', {});
    await flush();

    // Primeira tentativa falhou: nenhum socket foi criado ainda.
    expect(socketInstances).toHaveLength(0);
    expect(createSocketTicketMock).toHaveBeenCalledTimes(1);

    await vi.runOnlyPendingTimersAsync();
    await flush();

    expect(createSocketTicketMock).toHaveBeenCalledTimes(2);
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].opts.params).toEqual({ ticket: 'ticket-2' });

    disconnect();
  });

  it('reconexão após queda busca um ticket NOVO — nunca reusa o anterior', async () => {
    createSocketTicketMock
      .mockResolvedValueOnce({ ticket: 'ticket-a', expiresAt: new Date().toISOString() })
      .mockResolvedValueOnce({ ticket: 'ticket-b', expiresAt: new Date().toISOString() });

    const disconnect = connectSessionHeartbeat('proj-1', 'sess-1', {});
    await flush();

    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].opts.params).toEqual({ ticket: 'ticket-a' });

    // Simula a queda: dispara o callback que o socket registrou via onClose.
    const onCloseCallback = socketInstances[0].onClose.mock.calls[0][0] as () => void;
    onCloseCallback();

    await vi.runOnlyPendingTimersAsync();
    await flush();

    expect(createSocketTicketMock).toHaveBeenCalledTimes(2);
    expect(socketInstances).toHaveLength(2);
    expect(socketInstances[1].opts.params).toEqual({ ticket: 'ticket-b' });

    disconnect();
  });

  it('o reconnect NATIVO do Socket é neutralizado — reconexão é só manual', async () => {
    createSocketTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      expiresAt: new Date().toISOString(),
    });

    const disconnect = connectSessionHeartbeat('proj-1', 'sess-1', {});
    await flush();

    const { reconnectAfterMs } = socketInstances[0].opts;
    expect(reconnectAfterMs).toBeDefined();
    // Um dia inteiro, na prática nunca dispara dentro da vida do socket.
    expect(reconnectAfterMs!(1)).toBeGreaterThan(60 * 60 * 1000);

    disconnect();
  });

  it('cleanup (retorno) desliga o socket e IMPEDE reconexão automática', async () => {
    createSocketTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      expiresAt: new Date().toISOString(),
    });

    const disconnect = connectSessionHeartbeat('proj-1', 'sess-1', {});
    await flush();

    disconnect();
    expect(socketInstances[0].disconnect).toHaveBeenCalledTimes(1);

    // Mesmo se o handler onClose ainda disparasse depois do cleanup (ordem de
    // eventos assíncrona), a flag `parado` tem que barrar a reconexão.
    const onCloseCallback = socketInstances[0].onClose.mock.calls[0][0] as () => void;
    onCloseCallback();

    await vi.runAllTimersAsync();
    await flush();

    expect(createSocketTicketMock).toHaveBeenCalledTimes(1);
    expect(socketInstances).toHaveLength(1);
  });

  it('onToolCall: registra `tool.call` e repassa tool/agent, ignorando payload sem `tool` string', async () => {
    createSocketTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      expiresAt: new Date().toISOString(),
    });
    const onToolCall = vi.fn();

    const disconnect = connectSessionHeartbeat('proj-1', 'sess-1', { onToolCall });
    await flush();

    const chamada = fakeChannel.on.mock.calls.find(([evento]) => evento === 'tool.call');
    expect(chamada).toBeDefined();
    const callback = chamada![1] as (payload: { tool?: string; agent?: string }) => void;

    callback({ tool: 'create_story', agent: 'po' });
    expect(onToolCall).toHaveBeenCalledWith('create_story', 'po');

    callback({ tool: 'emit_artifact' });
    expect(onToolCall).toHaveBeenCalledWith('emit_artifact', undefined);

    onToolCall.mockClear();
    callback({});
    expect(onToolCall).not.toHaveBeenCalled();

    disconnect();
  });
});

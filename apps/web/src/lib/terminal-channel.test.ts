import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Canal `terminal:<projectId>` — roundtrip básico com `phoenix` e
 * `./api-client` substituídos por dublês, mesmo padrão de
 * `session-channel.test.ts`. `sessionRef` é gerado internamente
 * (`crypto.randomUUID()`) e não é exposto — os testes que precisam dele o
 * extraem do próprio `push('pty_open', ...)` observado no mock, em vez de
 * hardcodar um valor que teria que coincidir por acidente.
 */

const { FakeSocket, fakeChannel, socketInstances, getTerminalTicketMock, listeners } = vi.hoisted(
  () => {
    const listeners: Record<string, (payload: unknown) => void> = {};

    const fakeChannel = {
      join: vi.fn(),
      on: vi.fn((evento: string, cb: (payload: unknown) => void) => {
        listeners[evento] = cb;
      }),
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
      opts: { params?: { ticket?: string }; reconnectAfterMs?: () => number };
      connect = vi.fn();
      disconnect = vi.fn();
      channel = vi.fn(() => fakeChannel);
      onOpen = vi.fn();
      onClose = vi.fn();
      onError = vi.fn();

      constructor(
        url: string,
        opts: { params?: { ticket?: string }; reconnectAfterMs?: () => number },
      ) {
        this.url = url;
        this.opts = opts;
        socketInstances.push(this);
      }
    }

    const getTerminalTicketMock = vi.fn();

    return { FakeSocket, fakeChannel, socketInstances, getTerminalTicketMock, listeners };
  },
);

vi.mock('phoenix', () => ({ Socket: FakeSocket }));

vi.mock('./api-client', () => ({
  getTerminalTicket: (...args: unknown[]) => getTerminalTicketMock(...args),
}));

vi.mock('./logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), errorWithTrace: vi.fn() },
}));

import { connectTerminalChannel } from './terminal-channel';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** O `sessionRef` que o próprio módulo gerou — lido do push de `pty_open`. */
function sessionRefUsado(): string {
  const chamada = fakeChannel.push.mock.calls.find((c) => c[0] === 'pty_open');
  if (!chamada) throw new Error('pty_open ainda não foi empurrado');
  return (chamada[1] as { sessionRef: string }).sessionRef;
}

beforeEach(() => {
  socketInstances.length = 0;
  fakeChannel.join.mockClear();
  fakeChannel.push.mockClear();
  fakeChannel.leave.mockClear();
  fakeChannel.on.mockClear();
  getTerminalTicketMock.mockReset();
  for (const chave of Object.keys(listeners)) delete listeners[chave];
});

afterEach(() => {
  // Cobre o teste de timeout abaixo, que liga fake timers — garante que um
  // teste seguinte nunca herda o relógio congelado se algo falhar no meio.
  vi.useRealTimers();
});

describe('connectTerminalChannel', () => {
  it('caminho feliz: busca o ticket, conecta DIRETO no <engineWsUrl> do corpo do ticket (já `ws://…/runner`) e entra em terminal:<projectId>', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      // Já vem PRONTO de `engineWsUrlPublico()` — `ws://…/runner`, sem
      // `/websocket` (o próprio `Socket` do phoenix.js acrescenta isso).
      // Concatenar mais path aqui era o bug (RN-433): duplicava `/runner` e
      // antecipava o `/websocket`, e o engine recusava a conexão.
      engineWsUrl: 'ws://engine.local/runner',
    });

    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);
    await flush();

    expect(getTerminalTicketMock).toHaveBeenCalledWith('proj-1');
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].url).toBe('ws://engine.local/runner');
    expect(socketInstances[0].opts.params).toEqual({ ticket: 'ticket-1' });
    expect(socketInstances[0].channel).toHaveBeenCalledWith('terminal:proj-1', {});

    canal.fechar();
  });

  it('abrirPty ANTES do ticket voltar fica na fila e é disparada assim que o canal nasce', async () => {
    let resolverTicket: (v: { ticket: string; engineWsUrl: string }) => void;
    getTerminalTicketMock.mockReturnValue(
      new Promise((resolve) => {
        resolverTicket = resolve;
      }),
    );

    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);

    // Chamado ANTES do ticket resolver — `channel` ainda nem existe.
    canal.abrirPty(80, 24);
    expect(fakeChannel.push).not.toHaveBeenCalled();

    resolverTicket!({ ticket: 't-1', engineWsUrl: 'ws://engine.local/runner' });
    await flush();

    expect(fakeChannel.push).toHaveBeenCalledWith('pty_open', {
      sessionRef: expect.any(String),
      cols: 80,
      rows: 24,
    });

    canal.fechar();
  });

  it('pty_opened do sessionRef certo chama onAberto; de outro sessionRef é ignorado', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });
    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);
    await flush();

    canal.abrirPty(80, 24);
    const ref = sessionRefUsado();

    listeners['pty_opened']({ sessionRef: 'outro-ref-qualquer' });
    expect(handlers.onAberto).not.toHaveBeenCalled();

    listeners['pty_opened']({ sessionRef: ref });
    expect(handlers.onAberto).toHaveBeenCalledTimes(1);

    canal.fechar();
  });

  it('pty_error chama onErro com a mensagem do servidor — o sinal de "sem runner"', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });
    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);
    await flush();

    canal.abrirPty(80, 24);
    const ref = sessionRefUsado();

    listeners['pty_error']({ sessionRef: ref, message: 'nenhum runner conectado' });
    expect(handlers.onErro).toHaveBeenCalledWith('nenhum runner conectado');

    canal.fechar();
  });

  it('pty_data decodifica base64 e entrega texto pronto por onDados', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });
    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);
    await flush();

    canal.abrirPty(80, 24);
    const ref = sessionRefUsado();

    // "olá\n" em base64 (UTF-8) — cobre acento, não só ASCII puro.
    const base64 = btoa(unescape(encodeURIComponent('olá\n')));
    listeners['pty_data']({ sessionRef: ref, data: base64 });

    expect(handlers.onDados).toHaveBeenCalledWith('olá\n');

    canal.fechar();
  });

  it('enviarInput codifica o texto do usuário em base64 antes de empurrar pty_input', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });
    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);
    await flush();

    canal.enviarInput('ls -la\n');

    const chamada = fakeChannel.push.mock.calls.find((c) => c[0] === 'pty_input');
    expect(chamada).toBeDefined();
    const payload = chamada![1] as { data: string };
    expect(atob(payload.data)).toBe('ls -la\n');

    canal.fechar();
  });

  it('falha ao buscar o ticket chama onErro em vez de travar sem explicação', async () => {
    getTerminalTicketMock.mockRejectedValue(new Error('api fora do ar'));

    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    connectTerminalChannel('proj-1', handlers);
    await flush();

    expect(handlers.onErro).toHaveBeenCalledWith(expect.stringContaining('autorização'));
    expect(socketInstances).toHaveLength(0);
  });

  it('socket que nunca abre chama onErro dentro do timeout, sem reconexão automática do phoenix', async () => {
    vi.useFakeTimers();
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });

    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);

    // O fetch do ticket é assíncrono — sob fake timers, microtasks ainda
    // rodam sozinhas, mas precisamos ceder o loop de eventos pra promise
    // resolver antes de o socket nascer.
    await vi.advanceTimersByTimeAsync(0);

    expect(socketInstances).toHaveLength(1);
    // Reconexão automática do phoenix.js precisa estar DESLIGADA — senão o
    // backoff nativo dele reconectaria sozinho pra sempre e o timeout
    // próprio nunca teria chance de decidir nada.
    expect(socketInstances[0].opts.reconnectAfterMs?.()).toBeGreaterThan(
      60 * 60 * 1000,
    );
    expect(handlers.onErro).not.toHaveBeenCalled();

    // `onOpen` nunca é disparado (dublê, sem socket real) — o transporte
    // nunca abriu, exatamente o caso que o timeout cobre.
    await vi.advanceTimersByTimeAsync(8_000);

    expect(handlers.onErro).toHaveBeenCalledWith(
      expect.stringContaining('conectar'),
    );
    expect(socketInstances[0].disconnect).toHaveBeenCalled();

    canal.fechar();
    vi.useRealTimers();
  });

  it('fechar() é idempotente e desconecta o socket só uma vez', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });
    const handlers = { onAberto: vi.fn(), onErro: vi.fn(), onDados: vi.fn() };
    const canal = connectTerminalChannel('proj-1', handlers);
    await flush();

    canal.fechar();
    canal.fechar();

    expect(socketInstances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(fakeChannel.leave).toHaveBeenCalledTimes(1);
  });
});

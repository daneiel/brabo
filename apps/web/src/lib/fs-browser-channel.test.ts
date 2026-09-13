import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Canal `terminal:<projectId>` (papel navegação de pasta) — roundtrip básico
 * com `phoenix` e `./api-client` substituídos por dublês, mesmo padrão de
 * `terminal-channel.test.ts` irmão. Correlação por `ref` PRÓPRIO gerado por
 * chamada (não `sessionRef` fixo como o PTY), então os testes extraem o
 * `ref` do próprio `push` observado no mock.
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

import { connectFsBrowserChannel } from './fs-browser-channel';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** O `ref` que o próprio módulo gerou para o ÚLTIMO push do tipo dado. */
function refUsado(tipo: 'fs_list_dir' | 'fs_home_dir'): string {
  const chamada = [...fakeChannel.push.mock.calls].reverse().find((c) => c[0] === tipo);
  if (!chamada) throw new Error(`${tipo} ainda não foi empurrado`);
  return (chamada[1] as { ref: string }).ref;
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

describe('connectFsBrowserChannel', () => {
  it('conecta DIRETO no <engineWsUrl> do corpo do ticket, sem concatenar path (RN-433/RN-437)', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      // Já vem PRONTO de `engineWsUrlPublico()` — `ws://…/runner`, sem
      // `/websocket` (o próprio `Socket` do phoenix.js acrescenta isso).
      // Concatenar `/runner/websocket` aqui duplicava `/runner` e
      // antecipava `/websocket` — o mesmo bug que a RN-433 já tinha
      // corrigido no `terminal-channel.ts` irmão, achado aqui só ao
      // verificar a RN-437 contra um engine real.
      engineWsUrl: 'ws://engine.local/runner',
    });

    const canal = connectFsBrowserChannel('proj-1');
    await flush();

    expect(getTerminalTicketMock).toHaveBeenCalledWith('proj-1');
    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].url).toBe('ws://engine.local/runner');
    expect(socketInstances[0].opts.params).toEqual({ ticket: 'ticket-1' });
    expect(socketInstances[0].channel).toHaveBeenCalledWith('terminal:proj-1', {});

    canal.fechar();
  });

  it('diretorioInicial: empurra fs_home_dir e resolve com o path da resposta', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });

    const canal = connectFsBrowserChannel('proj-1');
    await flush();

    const promessa = canal.diretorioInicial();
    await flush();
    const ref = refUsado('fs_home_dir');
    listeners.fs_home_dir_reply({ ref, path: '/home/user' });

    await expect(promessa).resolves.toEqual({ path: '/home/user', erro: undefined });
    canal.fechar();
  });

  it('listarDiretorio: empurra fs_list_dir com o path pedido e resolve com as entradas', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });

    const canal = connectFsBrowserChannel('proj-1');
    await flush();

    const promessa = canal.listarDiretorio('/home/user');
    await flush();
    expect(fakeChannel.push).toHaveBeenCalledWith(
      'fs_list_dir',
      expect.objectContaining({ path: '/home/user' }),
    );
    const ref = refUsado('fs_list_dir');
    listeners.fs_list_dir_reply({
      ref,
      path: '/home/user',
      entradas: [{ nome: 'projetos', isDir: true }],
    });

    await expect(promessa).resolves.toEqual({
      path: '/home/user',
      entradas: [{ nome: 'projetos', isDir: true }],
      erro: undefined,
    });
    canal.fechar();
  });

  it('falha ao buscar o ticket resolve com erro em vez de travar sem explicação', async () => {
    getTerminalTicketMock.mockRejectedValue(new Error('sem rede'));

    const canal = connectFsBrowserChannel('proj-1');
    const resultado = await canal.diretorioInicial();

    expect(resultado.erro).toMatch(/não consegui pedir autorização/i);
    canal.fechar();
  });

  // RN-108 — o ticket de `getTerminalTicket` é de USO ÚNICO, e este módulo
  // não tem política própria de reconexão (o `onClose` manda "feche e reabra").
  // Sem neutralizar o auto-reconnect do phoenix.js, o socket ficava repetindo
  // o MESMO ticket em background enquanto o modal estivesse aberto — a mesma
  // linha de defeito que o `apps/runner` pagou com 429 na conta do usuário.
  it('neutraliza o auto-reconnect do Phoenix.Socket — ticket de uso único nunca é repetido (RN-108)', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });

    const canal = connectFsBrowserChannel('proj-1');
    await flush();

    expect(socketInstances).toHaveLength(1);
    expect(socketInstances[0].opts.params).toEqual({ ticket: 'ticket-1' });
    const { reconnectAfterMs } = socketInstances[0].opts;
    expect(reconnectAfterMs).toBeDefined();
    // Um dia inteiro: na prática nunca dispara dentro da vida do socket.
    expect(reconnectAfterMs!()).toBeGreaterThan(60 * 60 * 1000);

    canal.fechar();
  });

  it('fechar() é idempotente e desconecta o socket só uma vez', async () => {
    getTerminalTicketMock.mockResolvedValue({
      ticket: 'ticket-1',
      engineWsUrl: 'ws://engine.local/runner',
    });

    const canal = connectFsBrowserChannel('proj-1');
    await flush();

    canal.fechar();
    canal.fechar();

    expect(socketInstances[0].disconnect).toHaveBeenCalledTimes(1);
  });
});

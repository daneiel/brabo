import { describe, expect, it, vi } from 'vitest';
import {
  conectarCanal,
  enviarContainerRemoveResult,
  enviarContainerStartResult,
  enviarContainerStopResult,
  enviarExecResult,
  enviarWorkspaceConfirm,
  JoinRecusadoError,
  JoinTimeoutError,
  type ChannelLike,
  type CriarSocket,
  type PushLike,
  type SocketLike,
} from './channel.ts';

/**
 * Mock mínimo da API de `Socket`/`Channel` da lib `phoenix` — só o
 * subconjunto que `channel.ts` usa. Não há servidor Phoenix de teste real
 * neste pacote: mockar a lib é a abordagem mais barata para testar o
 * protocolo (roundtrip de mensagens, tratamento de recusa) sem depender de
 * um engine de verdade, que é justamente o que a R3 está construindo em
 * paralelo.
 */
function criarPushFalso(resultado: { status: 'ok' | 'error' | 'timeout'; resp?: unknown }): PushLike {
  const push: PushLike = {
    receive(status, cb) {
      if (status === resultado.status) {
        // Assíncrono, como a lib real (o servidor responde depois).
        queueMicrotask(() => cb(resultado.resp));
      }
      return push;
    },
  };
  return push;
}

class CanalFalso implements ChannelLike {
  eventos = new Map<string, (payload: unknown) => void>();
  pushes: { event: string; payload: unknown }[] = [];
  resultadoDoJoin: { status: 'ok' | 'error' | 'timeout'; resp?: unknown };

  constructor(resultadoDoJoin: { status: 'ok' | 'error' | 'timeout'; resp?: unknown }) {
    this.resultadoDoJoin = resultadoDoJoin;
  }

  join(): PushLike {
    return criarPushFalso(this.resultadoDoJoin);
  }

  on(event: string, cb: (payload: unknown) => void): void {
    this.eventos.set(event, cb);
  }

  push(event: string, payload: unknown): PushLike {
    this.pushes.push({ event, payload });
    return criarPushFalso({ status: 'ok' });
  }

  leave(): void {}

  /** Simula o servidor empurrando um evento (ex.: "exec"). */
  simularRecebimento(event: string, payload: unknown): void {
    this.eventos.get(event)?.(payload);
  }
}

class SocketFalso implements SocketLike {
  canal: CanalFalso;
  desconectado = false;
  onCloseCb: (() => void) | null = null;

  constructor(canal: CanalFalso) {
    this.canal = canal;
  }

  connect(): void {}
  disconnect(cb?: () => void): void {
    this.desconectado = true;
    cb?.();
  }
  onOpen(): void {}
  onError(): void {}
  onClose(cb: () => void): void {
    this.onCloseCb = cb;
  }
  channel(): ChannelLike {
    return this.canal;
  }
}

function fabricaFalsa(canal: CanalFalso): CriarSocket {
  return () => new SocketFalso(canal);
}

const handlersVazios = {
  onExec: vi.fn(),
  onPtyOpen: vi.fn(),
  onPtyInput: vi.fn(),
  onPtyResize: vi.fn(),
  onPtyClose: vi.fn(),
  onFsListDir: vi.fn(),
  onFsHomeDir: vi.fn(),
  onContainerStart: vi.fn(),
  onContainerStop: vi.fn(),
  onContainerRemove: vi.fn(),
};

describe('conectarCanal', () => {
  it('entra no canal e faz roundtrip de exec -> exec_result', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const canalHolder: { atual: ChannelLike | null } = { atual: null };
    const onExec = vi.fn((msg: { ref: string; command: string; cwd: string }) => {
      enviarExecResult(canalHolder.atual!, {
        ref: msg.ref,
        exitCode: 0,
        output: 'ok',
        timedOut: false,
      });
    });

    const conectado = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: { ...handlersVazios, onExec },
      criarSocket: fabricaFalsa(canal),
    });
    canalHolder.atual = conectado.channel;

    canal.simularRecebimento('exec', {
      ref: 'r1',
      command: 'echo oi',
      cwd: '/projeto',
    });

    expect(onExec).toHaveBeenCalledWith({
      ref: 'r1',
      command: 'echo oi',
      cwd: '/projeto',
    });
    expect(canal.pushes).toEqual([
      { event: 'exec_result', payload: { ref: 'r1', exitCode: 0, output: 'ok', timedOut: false } },
    ]);
  });

  // RN-507/ADR 0145 — `env` é OPCIONAL e só repassado quando é de verdade um
  // objeto string->string; um payload malformado (array, número, string
  // solta) some, em vez de virar env arbitrário do processo filho.
  it('exec com env (credencial de git, RN-507): repassa o objeto pro handler', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const onExec = vi.fn();

    await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: { ...handlersVazios, onExec },
      criarSocket: fabricaFalsa(canal),
    });

    canal.simularRecebimento('exec', {
      ref: 'r1',
      command: 'git fetch origin',
      cwd: '/projeto',
      env: { BRABO_GIT_TOKEN: 'segredo', BRABO_GIT_USERNAME: 'x-access-token' },
    });

    expect(onExec).toHaveBeenCalledWith({
      ref: 'r1',
      command: 'git fetch origin',
      cwd: '/projeto',
      env: { BRABO_GIT_TOKEN: 'segredo', BRABO_GIT_USERNAME: 'x-access-token' },
    });
  });

  it('exec com env malformado (não é objeto string->string): ignora o campo, nunca repassa', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const onExec = vi.fn();

    await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: { ...handlersVazios, onExec },
      criarSocket: fabricaFalsa(canal),
    });

    canal.simularRecebimento('exec', {
      ref: 'r1',
      command: 'echo oi',
      cwd: '/projeto',
      env: ['nao', 'e', 'um', 'objeto'],
    });

    expect(onExec).toHaveBeenCalledWith({
      ref: 'r1',
      command: 'echo oi',
      cwd: '/projeto',
    });
  });

  it('entra no canal e faz roundtrip de container_start -> container_start_result (ADR 0137)', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const canalHolder: { atual: ChannelLike | null } = { atual: null };
    const onContainerStart = vi.fn((msg: { ref: string; spec: unknown }) => {
      enviarContainerStartResult(canalHolder.atual!, {
        ref: msg.ref,
        sucesso: true,
        containerId: 'container-1',
        nome: 'brabo-proj-abc12345',
        jaEstavaDePe: false,
      });
    });

    const conectado = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: { ...handlersVazios, onContainerStart },
      criarSocket: fabricaFalsa(canal),
    });
    canalHolder.atual = conectado.channel;

    const spec = { workspaceDirName: 'proj-abc12345', imagem: 'node:22-bookworm-slim' };
    canal.simularRecebimento('container_start', { ref: 'r1', spec });

    expect(onContainerStart).toHaveBeenCalledWith({ ref: 'r1', spec });
    expect(canal.pushes).toEqual([
      {
        event: 'container_start_result',
        payload: {
          ref: 'r1',
          sucesso: true,
          containerId: 'container-1',
          nome: 'brabo-proj-abc12345',
          jaEstavaDePe: false,
        },
      },
    ]);
  });

  it('entra no canal e faz roundtrip de container_stop -> container_stop_result', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const canalHolder: { atual: ChannelLike | null } = { atual: null };
    const onContainerStop = vi.fn((msg: { ref: string; workspaceDirName: string }) => {
      enviarContainerStopResult(canalHolder.atual!, { ref: msg.ref, sucesso: true });
    });

    const conectado = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: { ...handlersVazios, onContainerStop },
      criarSocket: fabricaFalsa(canal),
    });
    canalHolder.atual = conectado.channel;

    canal.simularRecebimento('container_stop', { ref: 'r2', workspaceDirName: 'proj-abc12345' });

    expect(onContainerStop).toHaveBeenCalledWith({ ref: 'r2', workspaceDirName: 'proj-abc12345' });
    expect(canal.pushes).toEqual([
      { event: 'container_stop_result', payload: { ref: 'r2', sucesso: true } },
    ]);
  });

  it('entra no canal e faz roundtrip de container_remove -> container_remove_result', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const canalHolder: { atual: ChannelLike | null } = { atual: null };
    const onContainerRemove = vi.fn((msg: { ref: string; workspaceDirName: string }) => {
      enviarContainerRemoveResult(canalHolder.atual!, { ref: msg.ref, sucesso: true });
    });

    const conectado = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: { ...handlersVazios, onContainerRemove },
      criarSocket: fabricaFalsa(canal),
    });
    canalHolder.atual = conectado.channel;

    canal.simularRecebimento('container_remove', { ref: 'r3', workspaceDirName: 'proj-abc12345' });

    expect(onContainerRemove).toHaveBeenCalledWith({ ref: 'r3', workspaceDirName: 'proj-abc12345' });
    expect(canal.pushes).toEqual([
      { event: 'container_remove_result', payload: { ref: 'r3', sucesso: true } },
    ]);
  });

  it('rejeita com JoinRecusadoError quando o servidor recusa o join, sem retry embutido', async () => {
    const canal = new CanalFalso({ status: 'error', resp: { reason: 'ticket inválido' } });

    await expect(
      conectarCanal({
        engineWsUrl: 'ws://fake/runner/websocket',
        ticket: 'invalido',
        projectId: 'p1',
        handlers: handlersVazios,
        criarSocket: fabricaFalsa(canal),
      }),
    ).rejects.toBeInstanceOf(JoinRecusadoError);

    // Uma tentativa só: `conectarCanal` não reconecta sozinho. A política de
    // retry (se houver) é do CHAMADOR (`index.ts`), nunca deste módulo.
  });

  it('rejeita com JoinTimeoutError quando o join não responde a tempo', async () => {
    const canal = new CanalFalso({ status: 'timeout' });

    await expect(
      conectarCanal({
        engineWsUrl: 'ws://fake/runner/websocket',
        ticket: 't1',
        projectId: 'p1',
        handlers: handlersVazios,
        criarSocket: fabricaFalsa(canal),
      }),
    ).rejects.toBeInstanceOf(JoinTimeoutError);
  });

  /** RN-423 (ADR 0104) — o runner empurra o caminho logo que o canal conecta. */
  it('enviarWorkspaceConfirm empurra o caminho depois do join', async () => {
    const canal = new CanalFalso({ status: 'ok' });

    const conectado = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: handlersVazios,
      criarSocket: fabricaFalsa(canal),
    });

    enviarWorkspaceConfirm(conectado.channel, { path: '/home/voce/projetos/loja' });

    expect(canal.pushes).toEqual([
      { event: 'workspace_confirm', payload: { path: '/home/voce/projetos/loja' } },
    ]);
  });
});

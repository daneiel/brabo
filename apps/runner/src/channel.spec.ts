import { describe, expect, it, vi } from 'vitest';
import {
  CAPACIDADES_DO_RUNNER,
  conectarCanal,
  espelhoConcedidoDaResposta,
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
  /** O que o runner DECLAROU no join (RN-514) — tópico e params. */
  canaisPedidos: { topic: string; params?: object }[] = [];

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
  channel(topic: string, params?: object): ChannelLike {
    this.canaisPedidos.push({ topic, params });
    return this.canal;
  }
}

function fabricaFalsa(canal: CanalFalso, sockets?: SocketFalso[]): CriarSocket {
  return () => {
    const socket = new SocketFalso(canal);
    sockets?.push(socket);
    return socket;
  };
}

/**
 * Variante da fábrica que GUARDA o que foi passado ao construtor do `Socket`
 * — url e opções. É a única forma de assertar a neutralização do
 * auto-reconnect: um teste que só verifique "conecta" passava com o defeito
 * de pé, e passou, por várias versões (ver o docblock de `channel.ts`).
 */
function fabricaQueGuardaOpcoes(
  canal: CanalFalso,
  registro: { url: string; opts: Parameters<CriarSocket>[1] }[],
): CriarSocket {
  return (url, opts) => {
    registro.push({ url, opts });
    return new SocketFalso(canal);
  };
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
  onMirrorSync: vi.fn(),
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

  /**
   * ADR 0147 ponto 1 / RN-514 — o join deixou de ser mudo deste lado. A
   * asserção é sobre o CONTEÚDO dos params, não sobre a chamada ter
   * acontecido: params vazios eram justamente o estado anterior, e um teste
   * que só checasse "chamou `channel()`" passaria com eles.
   */
  it('declara as capacidades que sabe executar nos params do join', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const sockets: SocketFalso[] = [];

    await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: handlersVazios,
      criarSocket: fabricaFalsa(canal, sockets),
    });

    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.canaisPedidos).toEqual([
      { topic: 'terminal:p1', params: { capacidades: ['exec', 'pty', 'espelho'] } },
    ]);
  });

  /**
   * RN-516 — `espelho` entra na lista SÓ AGORA, e a asserção é sobre a lista
   * inteira de propósito: o que a negociação existe para impedir é declarar o
   * que não se implementa, e uma asserção frouxa (`toContain`) deixaria passar
   * um nome acrescentado antes do código dele existir.
   */
  it('declara as TRÊS capacidades que implementa — nem uma a mais', () => {
    expect([...CAPACIDADES_DO_RUNNER]).toEqual(['exec', 'pty', 'espelho']);
  });

  it('recusa por capacidade vira JoinRecusadoError (fatal, sem retry) com a mensagem do servidor legível', async () => {
    const motivo = {
      reason:
        'este projeto exige a(s) capacidade(s) `espelho`, que o brabo-runner ' +
        'conectado não declarou no join — o binário está desatualizado.',
    };
    const canal = new CanalFalso({ status: 'error', resp: motivo });

    const erro = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: handlersVazios,
      criarSocket: fabricaFalsa(canal),
    }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(JoinRecusadoError);
    // `index.ts` imprime `erro.message` e encerra — é a única chance de
    // explicar, então a razão do servidor tem que sobreviver até ali.
    expect((erro as JoinRecusadoError).message).toContain('espelho');
    expect((erro as JoinRecusadoError).motivo).toEqual(motivo);
  });

  /**
   * ADR 0147 pontos 4 e 8 / RN-516 — o destino viaja na CONCESSÃO do join, e
   * a mensagem `mirror_sync` só é entregue ao handler; quem confere o destino
   * contra a concessão é `tratarMirrorSync` (`index.ts`), testado em
   * `index-handlers.spec.ts`.
   */
  it('o destino do espelho vem na resposta do join e fica em `espelho`', async () => {
    const canal = new CanalFalso({
      status: 'ok',
      resp: { espelho: { destino: '/home/voce/espelhos/loja' } },
    });

    const conectado = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: handlersVazios,
      criarSocket: fabricaFalsa(canal),
    });

    expect(conectado.espelho).toEqual({ destino: '/home/voce/espelhos/loja' });
  });

  it('join sem concessão de espelho: `espelho` é null — o estado NORMAL', async () => {
    const canal = new CanalFalso({ status: 'ok', resp: {} });

    const conectado = await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: handlersVazios,
      criarSocket: fabricaFalsa(canal),
    });

    expect(conectado.espelho).toBeNull();
  });

  it('espelhoConcedidoDaResposta ignora resposta malformada em vez de inventar destino', () => {
    expect(espelhoConcedidoDaResposta(undefined)).toBeNull();
    expect(espelhoConcedidoDaResposta({ espelho: null })).toBeNull();
    expect(espelhoConcedidoDaResposta({ espelho: { destino: '' } })).toBeNull();
    expect(espelhoConcedidoDaResposta({ espelho: { destino: 42 } })).toBeNull();
    expect(espelhoConcedidoDaResposta({ espelho: { destino: '/x' } })).toEqual({
      destino: '/x',
    });
  });

  it('mirror_sync chega ao handler com destino e momento; sem `destino` não chega', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const onMirrorSync = vi.fn();

    await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: { ...handlersVazios, onMirrorSync },
      criarSocket: fabricaFalsa(canal),
    });

    canal.simularRecebimento('mirror_sync', {
      ref: 'm1',
      destino: '/home/voce/espelhos/loja',
      momento: 'commit',
    });
    expect(onMirrorSync).toHaveBeenCalledWith({
      ref: 'm1',
      destino: '/home/voce/espelhos/loja',
      momento: 'commit',
    });

    // `momento` ausente é rastro que falta, não motivo pra descartar a rodada.
    canal.simularRecebimento('mirror_sync', { ref: 'm2', destino: '/x' });
    expect(onMirrorSync).toHaveBeenCalledWith({
      ref: 'm2',
      destino: '/x',
      momento: 'desconhecido',
    });

    // Sem `destino` não há o que conferir contra a concessão — a mensagem não
    // vira "sincronize para onde você achar".
    canal.simularRecebimento('mirror_sync', { ref: 'm3' });
    expect(onMirrorSync).toHaveBeenCalledTimes(2);
  });

  // RN-108 — "reconexão, inclusive automática, sempre busca ticket novo".
  //
  // O que este teste assere é a OPÇÃO passada ao construtor do `Socket`, e
  // não o comentário do módulo nem "o runner conectou". Sem a opção, o
  // auto-reconnect embutido do phoenix.js repete com os MESMOS params — o
  // mesmo ticket já consumido — a cada ~5,13s (teto do backoff interno),
  // para sempre, em paralelo com a política de `index.ts`. Medido em
  // execução real: 61 recusas do `EngineWeb.RunnerSocket` em poucas horas e
  // 530 requisições num minuto contra o teto de 300 do `RATE_LIMIT_USER`,
  // debitadas do usuário dono da conta — que via 429 no navegador.
  it('neutraliza o auto-reconnect do Phoenix.Socket — ticket de uso único nunca é repetido (RN-108)', async () => {
    const canal = new CanalFalso({ status: 'ok' });
    const registro: { url: string; opts: Parameters<CriarSocket>[1] }[] = [];

    await conectarCanal({
      engineWsUrl: 'ws://fake/runner/websocket',
      ticket: 't1',
      projectId: 'p1',
      handlers: handlersVazios,
      criarSocket: fabricaQueGuardaOpcoes(canal, registro),
    });

    expect(registro).toHaveLength(1);
    const primeiro = registro[0];
    if (!primeiro) throw new Error('a fábrica não foi chamada');
    // O ticket viaja nos params — é justamente ele que o auto-reconnect
    // repetiria.
    expect(primeiro.opts.params).toEqual({ ticket: 't1' });

    const { reconnectAfterMs } = primeiro.opts;
    expect(reconnectAfterMs).toBeDefined();
    // Um dia inteiro, como no web: na prática nunca dispara dentro da vida
    // do socket. A asserção é sobre a ORDEM de grandeza, não sobre o número.
    expect(reconnectAfterMs()).toBeGreaterThan(60 * 60 * 1000);
  });
});

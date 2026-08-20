import { Socket } from 'phoenix';
import { logger } from './logger';
import { getTerminalTicket } from './api-client';

/**
 * Canal Phoenix `terminal:<projectId>` — MESMO tópico/ticket de
 * `terminal-channel.ts` (papel `web`), mas para a navegação de pasta local
 * (`fs_list_dir`/`fs_home_dir`) em vez do PTY. Ver o protocolo completo no
 * docblock de `apps/runner/src/channel.ts` e a ADR "Navegação de pasta
 * local via o Runner" (revisa a ADR 0072).
 *
 * ## Por que um módulo IRMÃO, e não uma extensão de `terminal-channel.ts`
 *
 * `connectTerminalChannel` é desenhado em torno de UMA sessão PTY por
 * conexão (`sessionRef` fixo, `abrirPty` implícito). Este módulo é
 * request/response — cada `listarDiretorio`/`diretorioInicial` é uma
 * chamada independente, correlacionada por `ref` PRÓPRIO gerado por
 * chamada, várias podendo estar em voo ao mesmo tempo (o usuário clica
 * rápido navegando pasta a pasta). Forçar os dois desenhos no mesmo módulo
 * complicaria os dois; o socket/ticket é o único código que se repete, e é
 * pequeno.
 */

export interface FsEntrada {
  nome: string;
  isDir: boolean;
}

export interface ListagemResultado {
  path: string;
  entradas: FsEntrada[];
  erro?: string;
}

export interface DiretorioInicialResultado {
  path?: string;
  erro?: string;
}

export interface FsBrowserChannel {
  /** Lista o conteúdo de `path` no runner. Nunca rejeita — falha vira `{erro}`. */
  listarDiretorio(path: string): Promise<ListagemResultado>;
  /** `os.homedir()` do runner — ponto de partida sem exigir digitação. */
  diretorioInicial(): Promise<DiretorioInicialResultado>;
  fechar(): void;
}

/** Generoso de propósito: cobre o pior caso de um runner ocupado, sem travar a UI para sempre. */
const TIMEOUT_REQUISICAO_MS = 20_000;

interface PendenteListagem {
  tipo: 'list';
  path: string;
  resolve: (r: ListagemResultado) => void;
  temporizador: ReturnType<typeof setTimeout>;
}

interface PendenteInicial {
  tipo: 'home';
  resolve: (r: DiretorioInicialResultado) => void;
  temporizador: ReturnType<typeof setTimeout>;
}

type Pendente = PendenteListagem | PendenteInicial;

export function connectFsBrowserChannel(projectId: string): FsBrowserChannel {
  let socket: Socket | null = null;
  let channel: ReturnType<Socket['channel']> | null = null;
  let fechado = false;
  /** Setado quando ticket/join/socket falha — daí em diante, toda chamada nova falha na hora. */
  let erroDeConexao: string | null = null;

  const pendentes = new Map<string, Pendente>();
  let filaAntesDoCanal: Array<() => void> = [];

  function enviar(fn: () => void) {
    if (channel) fn();
    else filaAntesDoCanal.push(fn);
  }

  function resolverComErro(ref: string, mensagem: string) {
    const pendente = pendentes.get(ref);
    if (!pendente) return;
    pendentes.delete(ref);
    clearTimeout(pendente.temporizador);
    if (pendente.tipo === 'list') {
      pendente.resolve({ path: pendente.path, entradas: [], erro: mensagem });
    } else {
      pendente.resolve({ erro: mensagem });
    }
  }

  function falharTudoPendente(mensagem: string) {
    for (const ref of [...pendentes.keys()]) resolverComErro(ref, mensagem);
  }

  async function conectar() {
    let ticket: string;
    let engineWsUrl: string;
    try {
      const emitido = await getTerminalTicket(projectId);
      ticket = emitido.ticket;
      engineWsUrl = emitido.engineWsUrl;
    } catch (erro) {
      logger.warn('não consegui obter ticket do canal de navegação de pasta', {
        projectId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      erroDeConexao =
        'Não consegui pedir autorização para navegar pastas — confira a conexão e tente de novo.';
      falharTudoPendente(erroDeConexao);
      return;
    }

    if (fechado) return;

    const wsUrl = engineWsUrl.replace(/^http/, 'ws') + '/runner/websocket';
    socket = new Socket(wsUrl, { params: { ticket } });

    socket.onError((erro: unknown) => {
      logger.warn('socket de navegação de pasta com erro', { projectId, erro: String(erro) });
    });
    socket.onClose(() => {
      logger.info('socket de navegação de pasta fechado', { projectId });
      if (!fechado) {
        erroDeConexao = 'A conexão com o runner caiu — feche e reabra para tentar de novo.';
        falharTudoPendente(erroDeConexao);
      }
    });

    socket.connect();

    const canal = socket.channel(`terminal:${projectId}`, {});

    canal.on('fs_list_dir_reply', (payload: unknown) => {
      const msg = payload as Partial<ListagemResultado> & { ref?: string };
      if (typeof msg?.ref !== 'string') return;
      const pendente = pendentes.get(msg.ref);
      if (!pendente || pendente.tipo !== 'list') return;
      pendentes.delete(msg.ref);
      clearTimeout(pendente.temporizador);
      pendente.resolve({
        path: typeof msg.path === 'string' ? msg.path : pendente.path,
        entradas: Array.isArray(msg.entradas) ? msg.entradas : [],
        erro: msg.erro,
      });
    });

    canal.on('fs_home_dir_reply', (payload: unknown) => {
      const msg = payload as Partial<DiretorioInicialResultado> & { ref?: string };
      if (typeof msg?.ref !== 'string') return;
      const pendente = pendentes.get(msg.ref);
      if (!pendente || pendente.tipo !== 'home') return;
      pendentes.delete(msg.ref);
      clearTimeout(pendente.temporizador);
      pendente.resolve({ path: msg.path, erro: msg.erro });
    });

    canal
      .join()
      .receive('error', (resp: unknown) => {
        logger.warn('não foi possível entrar no canal de navegação de pasta', {
          projectId,
          resp,
        });
        erroDeConexao = 'Não consegui abrir o canal com o engine — tente de novo em instantes.';
        falharTudoPendente(erroDeConexao);
      })
      .receive('timeout', () => {
        logger.warn('timeout ao entrar no canal de navegação de pasta', { projectId });
        erroDeConexao = 'O engine demorou demais para responder. Tente de novo.';
        falharTudoPendente(erroDeConexao);
      });

    if (fechado) {
      canal.leave();
      socket.disconnect();
      return;
    }

    channel = canal;
    const pendentesFila = filaAntesDoCanal;
    filaAntesDoCanal = [];
    pendentesFila.forEach((fn) => fn());
  }

  void conectar();

  return {
    listarDiretorio(path: string) {
      if (erroDeConexao) {
        return Promise.resolve({ path, entradas: [], erro: erroDeConexao });
      }
      const ref = crypto.randomUUID();
      return new Promise<ListagemResultado>((resolve) => {
        const temporizador = setTimeout(() => {
          resolverComErro(ref, 'O runner demorou demais para responder.');
        }, TIMEOUT_REQUISICAO_MS);
        pendentes.set(ref, { tipo: 'list', path, resolve, temporizador });
        enviar(() => channel!.push('fs_list_dir', { ref, path }));
      });
    },
    diretorioInicial() {
      if (erroDeConexao) {
        return Promise.resolve({ erro: erroDeConexao });
      }
      const ref = crypto.randomUUID();
      return new Promise<DiretorioInicialResultado>((resolve) => {
        const temporizador = setTimeout(() => {
          resolverComErro(ref, 'O runner demorou demais para responder.');
        }, TIMEOUT_REQUISICAO_MS);
        pendentes.set(ref, { tipo: 'home', resolve, temporizador });
        enviar(() => channel!.push('fs_home_dir', { ref }));
      });
    },
    fechar() {
      if (fechado) return;
      fechado = true;
      filaAntesDoCanal = [];
      falharTudoPendente('Navegação encerrada.');
      channel?.leave();
      socket?.disconnect();
    },
  };
}

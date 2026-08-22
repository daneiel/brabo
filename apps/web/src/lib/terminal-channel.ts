import { Socket } from 'phoenix';
import { logger } from './logger';
import { getTerminalTicket } from './api-client';

/**
 * Canal Phoenix `terminal:<projectId>` — o lado WEB do runner local + PTY
 * interativo. Espectador/operador (papel `web`, implícito pelo tipo do
 * ticket), distinto do papel `runner` que uma frente PARALELA (`apps/runner`,
 * fora deste módulo) fala do outro lado do MESMO tópico. O servidor faz o
 * relay entre os dois papéis; esta camada nunca fala com o runner direto.
 *
 * Mesmo padrão de `session-channel.ts` (RN-108): ticket opaco de uso único
 * ANTES de `socket.connect()`. Duas diferenças deliberadas em relação àquele
 * módulo:
 *
 * 1. Socket NOVO (`/runner`, não `/socket`) — `engineWsUrl` chega no PRÓPRIO
 *    corpo do ticket (`getTerminalTicket`), então esta função nunca deriva a
 *    URL de `runtimeConfig` como o heartbeat da sessão faz.
 * 2. Sem reconexão automática: o terminal interativo é uma sessão PTY viva no
 *    runner do usuário — uma queda de socket não tem "retomar do mesmo jeito"
 *    sem reabrir a sessão PTY também (o runner pode ter encerrado o processo).
 *    `fechar()` é o único jeito de encerrar, e uma queda inesperada é
 *    reportada por `onDesconectado` pro chamador decidir (hoje, `TerminalPanel`
 *    trata como "sem runner" e deixa o usuário tentar de novo).
 */

export interface TerminalChannelHandlers {
  /** `pty_opened` — a sessão PTY abriu no runner do usuário. */
  onAberto: () => void;
  /** `pty_error`, OU falha de ticket/join/timeout — sempre com mensagem legível. */
  onErro: (mensagem: string) => void;
  /** `pty_data` já decodificado de base64 — texto pronto pra escrever no xterm. */
  onDados: (texto: string) => void;
  /** Socket caiu depois de aberto (não é o `pty_error` inicial). */
  onDesconectado?: () => void;
}

export interface TerminalChannel {
  /** Pede a abertura da sessão PTY com o tamanho inicial do terminal. */
  abrirPty: (cols: number, rows: number) => void;
  /** O que o usuário digitou — vira `pty_input` codificado em base64. */
  enviarInput: (texto: string) => void;
  /** Novo tamanho do terminal (resize da janela/painel). */
  redimensionar: (cols: number, rows: number) => void;
  /** `pty_close` + `channel.leave()` + `socket.disconnect()`. Idempotente. */
  fechar: () => void;
}

/** UTF-8 seguro: `btoa`/`atob` puros truncam qualquer código acima de 0xFF. */
function paraBase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(base64: string): string {
  const binario = atob(base64);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Conecta ao canal do projeto e abre uma sessão PTY. `sessionRef` é gerado
 * aqui (um por chamada) — é o vínculo entre o `pty_open` desta abertura e os
 * `pty_opened`/`pty_error`/`pty_data` que respondem a ELA, nunca a uma sessão
 * PTY anterior no mesmo tópico.
 */
export function connectTerminalChannel(
  projectId: string,
  handlers: TerminalChannelHandlers,
): TerminalChannel {
  const sessionRef = crypto.randomUUID();

  let socket: Socket | null = null;
  let channel: ReturnType<Socket['channel']> | null = null;
  let fechado = false;
  let ptyAberto = false;

  // `abrirPty`/`enviarInput`/`redimensionar` podem ser chamados pelo
  // `TerminalPanel` ANTES do ticket voltar (o fetch é assíncrono, o mount não
  // espera). `channel` só existe depois disso, então uma chamada antes dele
  // fica nesta fila e é disparada assim que o canal nasce — a partir daí, o
  // PRÓPRIO `phoenix` já enfileira pushes até o `join` confirmar (`pushBuffer`
  // interno), então não precisamos replicar essa segunda metade da espera.
  let filaAntesDoCanal: Array<() => void> = [];

  function enviar(fn: () => void) {
    if (channel) fn();
    else filaAntesDoCanal.push(fn);
  }

  async function conectar() {
    let ticket: string;
    let engineWsUrl: string;
    try {
      const emitido = await getTerminalTicket(projectId);
      ticket = emitido.ticket;
      engineWsUrl = emitido.engineWsUrl;
    } catch (erro) {
      logger.warn('não consegui obter ticket do canal de terminal', {
        projectId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      handlers.onErro(
        'Não consegui pedir autorização pro terminal — confira a conexão e tente de novo.',
      );
      return;
    }

    if (fechado) return;

    const wsUrl = engineWsUrl.replace(/^http/, 'ws') + '/runner/websocket';
    socket = new Socket(wsUrl, { params: { ticket } });

    socket.onError((erro: unknown) => {
      logger.warn('socket do terminal com erro', { projectId, erro: String(erro) });
    });
    socket.onClose(() => {
      logger.info('socket do terminal fechado', { projectId });
      if (!fechado && ptyAberto) handlers.onDesconectado?.();
    });

    socket.connect();

    const canal = socket.channel(`terminal:${projectId}`, {});

    canal.on('pty_opened', (payload: { sessionRef?: string }) => {
      if (payload?.sessionRef !== sessionRef) return;
      ptyAberto = true;
      handlers.onAberto();
    });
    canal.on('pty_error', (payload: { sessionRef?: string; message?: string }) => {
      if (payload?.sessionRef !== sessionRef) return;
      handlers.onErro(
        payload.message ||
          'O runner não respondeu ao pedido de abrir o terminal.',
      );
    });
    canal.on('pty_data', (payload: { sessionRef?: string; data?: string }) => {
      if (payload?.sessionRef !== sessionRef || typeof payload.data !== 'string') return;
      handlers.onDados(deBase64(payload.data));
    });

    canal
      .join()
      .receive('error', (resp: unknown) => {
        logger.warn('não foi possível entrar no canal de terminal', { projectId, resp });
        handlers.onErro(
          'Não consegui abrir o canal do terminal com o engine — tente de novo em instantes.',
        );
      })
      .receive('timeout', () => {
        logger.warn('timeout ao entrar no canal de terminal', { projectId });
        handlers.onErro('O engine demorou demais para responder. Tente de novo.');
      });

    if (fechado) {
      canal.leave();
      socket.disconnect();
      return;
    }

    channel = canal;
    const pendentes = filaAntesDoCanal;
    filaAntesDoCanal = [];
    pendentes.forEach((fn) => fn());
  }

  void conectar();

  return {
    abrirPty(cols: number, rows: number) {
      enviar(() => channel!.push('pty_open', { sessionRef, cols, rows }));
    },
    enviarInput(texto: string) {
      enviar(() =>
        channel!.push('pty_input', { sessionRef, data: paraBase64(texto) }),
      );
    },
    redimensionar(cols: number, rows: number) {
      enviar(() => channel!.push('pty_resize', { sessionRef, cols, rows }));
    },
    fechar() {
      if (fechado) return;
      fechado = true;
      filaAntesDoCanal = [];
      channel?.push('pty_close', { sessionRef });
      channel?.leave();
      socket?.disconnect();
    },
  };
}

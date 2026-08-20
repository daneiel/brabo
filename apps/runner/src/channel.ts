/**
 * Canal Phoenix do runner — lado cliente do contrato fixado com a R3
 * (`Engine`/`api`, em construção em paralelo). Ver o resumo do contrato no
 * prompt da tarefa; a única fonte viva dele, além deste comentário, é o
 * código dos dois lados — não há doc formal do protocolo neste incremento.
 *
 * ## Por que a `Socket`/`Channel` da lib `phoenix` entram por FÁBRICA
 *
 * `conectarCanal` recebe um `criarSocket` injetável (default: a `Socket` de
 * verdade da lib `phoenix`, sobre WebSocket nativo do Node) para o teste
 * conseguir substituir por um mock da API mínima que usamos — sem isso não
 * haveria como testar roundtrip de `exec`→`exec_result` sem um engine de
 * verdade rodando.
 *
 * ## Reconexão: mesma disciplina de `apps/web/src/lib/session-channel.ts`
 * (RN-108)
 *
 * O ticket é de USO ÚNICO — reconectar com o MESMO ticket nunca funciona.
 * `reconnectAfterMs` embutido do `Phoenix.Socket` é por isso neutralizado
 * (ver `index.ts`, que é quem decide a política de reconexão: busca ticket
 * NOVO via HTTP antes de cada tentativa, com backoff). Este módulo não
 * decide política de retry — só conecta UMA vez e resolve/rejeita.
 */

export interface ExecMessage {
  ref: string;
  command: string;
  cwd: string;
}

export interface ExecResultMessage {
  ref: string;
  exitCode: number;
  output: string;
  timedOut: boolean;
}

export interface PtyOpenMessage {
  sessionRef: string;
  cols: number;
  rows: number;
}

export interface PtyOpenedMessage {
  sessionRef: string;
}

export interface PtyErrorMessage {
  sessionRef: string;
  message: string;
}

export interface PtyDataMessage {
  sessionRef: string;
  /** base64 */
  data: string;
}

export interface PtyResizeMessage {
  sessionRef: string;
  cols: number;
  rows: number;
}

export interface PtyCloseMessage {
  sessionRef: string;
}

/**
 * Navegação de pasta local (ADR sobre navegação de pasta via o Runner) —
 * MESMO desenho do `exec`/PTY: correlacionado por `ref`, sempre iniciado
 * pela `:web`. Leitura pura, nunca passa pelo `guard.ts` (que restringe
 * `cwd` de comando já APROVADO) — o propósito aqui é o oposto: navegar
 * LIVRE pela máquina do usuário, com os privilégios que ele já tem no SO.
 */
export interface FsEntrada {
  nome: string;
  isDir: boolean;
}

export interface FsListDirMessage {
  ref: string;
  path: string;
}

export interface FsListDirReplyMessage {
  ref: string;
  path: string;
  entradas: FsEntrada[];
  erro?: string;
}

export interface FsHomeDirMessage {
  ref: string;
}

export interface FsHomeDirReplyMessage {
  ref: string;
  path?: string;
  erro?: string;
}

export interface RunnerChannelHandlers {
  onExec: (msg: ExecMessage) => void;
  onPtyOpen: (msg: PtyOpenMessage) => void;
  onPtyInput: (msg: PtyDataMessage) => void;
  onPtyResize: (msg: PtyResizeMessage) => void;
  onPtyClose: (msg: PtyCloseMessage) => void;
  onFsListDir: (msg: FsListDirMessage) => void;
  onFsHomeDir: (msg: FsHomeDirMessage) => void;
  /** Chamado quando a conexão cai DEPOIS de já ter entrado no canal. */
  onDisconnected?: () => void;
}

/**
 * A parte da API de `Push` (retorno de `channel.join()`/`channel.push()`) que
 * este módulo usa — subconjunto do que a lib `phoenix` expõe.
 */
export interface PushLike {
  receive(status: 'ok' | 'error' | 'timeout', cb: (resp?: unknown) => void): PushLike;
}

/** Subconjunto de `Channel` da lib `phoenix` usado aqui. */
export interface ChannelLike {
  join(): PushLike;
  on(event: string, cb: (payload: unknown) => void): void;
  push(event: string, payload: unknown): PushLike;
  leave(): void;
}

/** Subconjunto de `Socket` da lib `phoenix` usado aqui. */
export interface SocketLike {
  connect(): void;
  disconnect(cb?: () => void): void;
  onOpen(cb: () => void): void;
  onError(cb: (erro: unknown) => void): void;
  onClose(cb: () => void): void;
  channel(topic: string, params?: object): ChannelLike;
}

export type CriarSocket = (
  url: string,
  opts: { params: Record<string, unknown> },
) => SocketLike | Promise<SocketLike>;

/** Join recusado pelo servidor (ticket inválido/expirado, segundo runner no mesmo projeto, etc). */
export class JoinRecusadoError extends Error {
  // Propriedade explícita, não parameter property — `erasableSyntaxOnly`
  // (ver tsconfig.json deste pacote) recusa a forma curta.
  readonly motivo: unknown;

  constructor(motivo: unknown) {
    super(
      `o servidor recusou a entrada no canal do runner: ${JSON.stringify(motivo)}. ` +
        `Isto não é transitório — peça um ticket novo e tente de novo manualmente ` +
        `em vez de insistir automaticamente (pode ser outro runner já conectado ` +
        `neste projeto).`,
    );
    this.name = 'JoinRecusadoError';
    this.motivo = motivo;
  }
}

/** Join que não respondeu a tempo — trata como falha do mesmo jeito (sem retry embutido aqui). */
export class JoinTimeoutError extends Error {
  constructor() {
    super('entrar no canal do runner expirou (timeout) sem resposta do servidor.');
    this.name = 'JoinTimeoutError';
  }
}

const criarSocketPadrao: CriarSocket = async (url, opts) => {
  // Import dinâmico: só carrega a lib (e o WebSocket nativo do Node que ela
  // precisa) quando de fato vai conectar — o que também facilita mockar em
  // teste sem a lib real no caminho.
  const { Socket } = await import('phoenix');
  return new Socket(url, opts) as unknown as SocketLike;
};

export interface ConectarCanalOpts {
  engineWsUrl: string;
  ticket: string;
  projectId: string;
  handlers: RunnerChannelHandlers;
  /** Injetável para teste — default é a `Socket` real da lib `phoenix`. */
  criarSocket?: CriarSocket;
}

export interface CanalConectado {
  socket: SocketLike;
  channel: ChannelLike;
  /** Encerra a conexão de propósito (não deve disparar reconexão do chamador). */
  desconectar(): void;
}

/**
 * Conecta UMA vez ao socket `/runner` e entra no tópico `terminal:<projectId>`.
 *
 * Resolve com o canal já JOINED. Rejeita com `JoinRecusadoError`/
 * `JoinTimeoutError` se a entrada for recusada — quem chama decide o que
 * fazer (`index.ts`: parar, nunca laço automático).
 */
export function conectarCanal(opts: ConectarCanalOpts): Promise<CanalConectado> {
  const { engineWsUrl, ticket, projectId, handlers } = opts;
  const criar = opts.criarSocket ?? criarSocketPadrao;

  return new Promise((resolvePromise, rejectPromise) => {
    void (async () => {
      const socket = await criar(engineWsUrl, { params: { ticket } });

      socket.onError((erro: unknown) => {
        // Erro de transporte pode chegar antes OU depois do join resolver;
        // se já resolvemos, é o `onDisconnected` do chamador que trata.
        void erro;
      });
      socket.onClose(() => {
        handlers.onDisconnected?.();
      });

      socket.connect();

      const canal = socket.channel(`terminal:${projectId}`, {});

      canal
        .join()
        .receive('ok', () => {
          registrarHandlers(canal, handlers);
          resolvePromise({
            socket,
            channel: canal,
            desconectar: () => {
              canal.leave();
              socket.disconnect();
            },
          });
        })
        .receive('error', (resp: unknown) => {
          socket.disconnect();
          rejectPromise(new JoinRecusadoError(resp));
        })
        .receive('timeout', () => {
          socket.disconnect();
          rejectPromise(new JoinTimeoutError());
        });
    })();
  });
}

function registrarHandlers(canal: ChannelLike, handlers: RunnerChannelHandlers): void {
  canal.on('exec', (payload: unknown) => {
    const msg = payload as Partial<ExecMessage>;
    if (
      typeof msg?.ref === 'string' &&
      typeof msg.command === 'string' &&
      typeof msg.cwd === 'string'
    ) {
      handlers.onExec({ ref: msg.ref, command: msg.command, cwd: msg.cwd });
    }
  });

  canal.on('pty_open', (payload: unknown) => {
    const msg = payload as Partial<PtyOpenMessage>;
    if (
      typeof msg?.sessionRef === 'string' &&
      typeof msg.cols === 'number' &&
      typeof msg.rows === 'number'
    ) {
      handlers.onPtyOpen({ sessionRef: msg.sessionRef, cols: msg.cols, rows: msg.rows });
    }
  });

  canal.on('pty_input', (payload: unknown) => {
    const msg = payload as Partial<PtyDataMessage>;
    if (typeof msg?.sessionRef === 'string' && typeof msg.data === 'string') {
      handlers.onPtyInput({ sessionRef: msg.sessionRef, data: msg.data });
    }
  });

  canal.on('pty_resize', (payload: unknown) => {
    const msg = payload as Partial<PtyResizeMessage>;
    if (
      typeof msg?.sessionRef === 'string' &&
      typeof msg.cols === 'number' &&
      typeof msg.rows === 'number'
    ) {
      handlers.onPtyResize({ sessionRef: msg.sessionRef, cols: msg.cols, rows: msg.rows });
    }
  });

  canal.on('pty_close', (payload: unknown) => {
    const msg = payload as Partial<PtyCloseMessage>;
    if (typeof msg?.sessionRef === 'string') {
      handlers.onPtyClose({ sessionRef: msg.sessionRef });
    }
  });

  canal.on('fs_list_dir', (payload: unknown) => {
    const msg = payload as Partial<FsListDirMessage>;
    if (typeof msg?.ref === 'string' && typeof msg.path === 'string') {
      handlers.onFsListDir({ ref: msg.ref, path: msg.path });
    }
  });

  canal.on('fs_home_dir', (payload: unknown) => {
    const msg = payload as Partial<FsHomeDirMessage>;
    if (typeof msg?.ref === 'string') {
      handlers.onFsHomeDir({ ref: msg.ref });
    }
  });
}

export function enviarExecResult(canal: ChannelLike, msg: ExecResultMessage): void {
  canal.push('exec_result', msg);
}

export function enviarPtyOpened(canal: ChannelLike, msg: PtyOpenedMessage): void {
  canal.push('pty_opened', msg);
}

export function enviarPtyError(canal: ChannelLike, msg: PtyErrorMessage): void {
  canal.push('pty_error', msg);
}

export function enviarPtyData(canal: ChannelLike, msg: PtyDataMessage): void {
  canal.push('pty_data', msg);
}

export function enviarFsListDirReply(canal: ChannelLike, msg: FsListDirReplyMessage): void {
  canal.push('fs_list_dir_reply', msg);
}

export function enviarFsHomeDirReply(canal: ChannelLike, msg: FsHomeDirReplyMessage): void {
  canal.push('fs_home_dir_reply', msg);
}

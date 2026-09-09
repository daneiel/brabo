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
  /**
   * Credencial de git (ADR 0056), estendida ao protocolo pela RN-507/ADR
   * 0145 — Docker virou pré-requisito real do modo `runner`, e a
   * materialização do worktree do dev agent (`Engine.Actions.Workspace.
   * RunnerGit`) passou a viajar pelo MESMO canal `exec`/`exec_result` que já
   * executa terminal aprovado. Opcional: comando de terminal comum nunca
   * carrega este campo. Repassado só pro `spawn` do HOST (`exec.ts`) — NUNCA
   * pro `docker exec` (sem suporte a `env` em `packages/docker-port`, de
   * propósito) nem concatenado na string do comando, e NUNCA logado (ver
   * `index.ts`).
   */
  env?: Record<string, string>;
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

/** RN-423 (ADR 0104) — o caminho que este runner recebeu por `--dir`. */
export interface WorkspaceConfirmMessage {
  path: string;
}

/**
 * `workspace_create` (ADR 0151 ponto 3, RN-532) — o engine pede a CRIAÇÃO da
 * pasta de um projeto sob a base LOCAL deste runner. Só o servidor origina; o
 * runner responde `workspace_create_result`.
 *
 * Molde de PEDIDO COM RESPOSTA (`exec`/`exec_result`), e não o de
 * `workspace_confirm` — este é UNIDIRECIONAL do outro lado (o canal responde
 * `{:noreply, socket}` e não empurra nada de volta), e quem pede a criação
 * precisa saber se deu certo.
 *
 * `segmento` é RELATIVO à base, e é o ÚNICO pedaço de caminho que atravessa a
 * rede: a base é local, consentida no instalador (RN-529), e nunca vem do
 * servidor. É o invariante do ADR 0130/0144 — quem tem a raiz é quem executa.
 * Um segmento absoluto é RECUSADO por léxico em `base-guard.ts`, nunca aceito
 * e reinterpretado.
 *
 * `repoUrl` ausente é `git init` (projeto novo); presente é `git clone`.
 * `env` é a credencial de git (ADR 0056), pelo MESMO mecanismo que a RN-507/ADR
 * 0145 acrescentou ao `exec`: mesclada sobre `process.env` no processo filho do
 * HOST, nunca repassada a `docker exec` e nunca logada. É o que faz o ADR 0151
 * poder declarar que este clone não sofre da lacuna da credencial descartada.
 */
export interface WorkspaceCreateMessage {
  ref: string;
  projectId: string;
  segmento: string;
  repoUrl?: string;
  env?: Record<string, string>;
}

/**
 * `workspace_create_result` (ADR 0151 ponto 3, RN-532) — sucesso com o caminho
 * FINAL, ou erro NOMEADO.
 *
 * `motivo` é um código curto (`sem-base`, `segmento`, `nao-e-pasta`, `mkdir`,
 * `git`) e existe separado de `erro` de propósito: `erro` é o texto que um
 * humano lê, `motivo` é o que o outro lado DECIDE em cima. Colapsar os dois
 * obrigaria o engine a casar substring de pt-BR.
 *
 * `caminho` só vem no sucesso, e é o mesmo que segue no `workspace_confirm`
 * empurrado logo antes dele — é ele, e nunca este resultado, que GRAVA
 * (ADR 0151 ponto 3: nenhuma rota nova de gravação nasce).
 */
export interface WorkspaceCreateResultMessage {
  ref: string;
  sucesso: boolean;
  caminho?: string;
  motivo?: string;
  erro?: string;
}

/**
 * `mirror_sync` (ADR 0147 pontos 4 e 8, RN-516) — o engine pede UMA rodada do
 * espelho, num MOMENTO NOMEADO (hoje: o commit). Só o servidor origina; o
 * runner responde `mirror_sync_result` (RN-517) DEPOIS de a rodada terminar —
 * sem ninguém bloqueado esperando por ela dos dois lados.
 *
 * `destino` viaja na mensagem para ser CONFERIDO contra o que foi concedido
 * no join desta conexão (`EspelhoConcedido`), nunca para ser obedecido: um
 * destino que o servidor mandou e o join não concedeu é recusado aqui. Ver
 * `tratarMirrorSync` em `index.ts`.
 *
 * `momento` é só rastro para o log local — "commit", e amanhã o que o ADR
 * chamar de fim de turno. O runner não decide nada com ele.
 */
export interface MirrorSyncMessage {
  ref: string;
  destino: string;
  momento: string;
}

/**
 * `mirror_sync_result` (ADR 0147 ponto 7, RN-517) — o desfecho REAL de UMA
 * rodada do espelho, empurrado DEPOIS que ela terminou. Nunca um "ok"
 * otimista antes do fim: quem mede o espelho tem de poder confiar que a
 * contagem é do que foi copiado de verdade.
 *
 * FIRE-AND-FORGET nos dois sentidos, ao contrário de
 * `container_start_result`/`exec_result`: ninguém do lado servidor está
 * bloqueado esperando por ele (o `mirror_sync` que o originou também não
 * esperava). O `ref` é o mesmo da rodada, e serve para correlacionar log dos
 * dois lados — nada é resolvido por ele.
 *
 * `sucesso: false` carrega `erro` NOMEADO, e é o único campo que a tela tem
 * para dizer o que houve. As contagens vêm direto do `ResultadoDoEspelho` de
 * `espelho.ts` — nunca recontadas aqui.
 */
export interface MirrorSyncResultMessage {
  ref: string;
  sucesso: boolean;
  /** O destino resolvido (sucesso) ou tentado (falha); ausente quando não há. */
  destino?: string;
  copiados?: number;
  pulados?: number;
  recusados?: number;
  erro?: string;
}

/**
 * O que o servidor CONCEDEU no `join` para a capacidade `espelho` (ADR 0147
 * ponto 4): o destino DAQUELA conexão, e nada mais.
 *
 * Por que aqui e não em configuração do runner: um destino global faria o
 * artefato do projeto B aterrissar na pasta do projeto A, e o usuário
 * descobriria isso pelo CONTEÚDO, não por um erro. Nunca variável de
 * ambiente, nunca arquivo local — o destino é por PROJETO, mora na api
 * (RN-515) e chega junto da concessão.
 */
export interface EspelhoConcedido {
  destino: string;
}

/**
 * O runner sobe o container do projeto (ADR 0137) — MESMO par exec/
 * exec_result, três vezes: `container_start`/`_result`, `container_stop`/
 * `_result`, `container_remove`/`_result`. Só a api (via engine) origina;
 * este runner só responde.
 *
 * `spec` são os mesmos campos de `EntradaDeEspecificacao`
 * (`@brabo/docker-port`) MENOS `raizDoProjeto` — este runner enche esse
 * campo sozinho, com a raiz já confirmada e validada no startup da CLI
 * (RN-434/435). Ninguém do lado servidor manda caminho de host nenhum pra
 * cá, pelo mesmo motivo que o broker nunca manda um pro daemon: quem sabe o
 * caminho de VERDADE é quem está na máquina.
 */
export interface ContainerSpecPayload {
  workspaceDirName: unknown;
  projectId: unknown;
  projectSlug: unknown;
  workspaceId: unknown;
  imagem: unknown;
  imagemVersao: unknown;
  rede: unknown;
  cpus: unknown;
  memoriaMb: unknown;
  pidsLimit: unknown;
}

export interface ContainerStartMessage {
  ref: string;
  spec: ContainerSpecPayload;
}

export interface ContainerStartResultMessage {
  ref: string;
  sucesso: boolean;
  containerId?: string;
  nome?: string;
  jaEstavaDePe?: boolean;
  erro?: string;
}

export interface ContainerStopMessage {
  ref: string;
  workspaceDirName: string;
}

export interface ContainerStopResultMessage {
  ref: string;
  sucesso: boolean;
  erro?: string;
}

export interface ContainerRemoveMessage {
  ref: string;
  workspaceDirName: string;
}

export interface ContainerRemoveResultMessage {
  ref: string;
  sucesso: boolean;
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
  onContainerStart: (msg: ContainerStartMessage) => void;
  onContainerStop: (msg: ContainerStopMessage) => void;
  onContainerRemove: (msg: ContainerRemoveMessage) => void;
  onMirrorSync: (msg: MirrorSyncMessage) => void;
  onWorkspaceCreate: (msg: WorkspaceCreateMessage) => void;
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

/**
 * As capacidades que ESTE binário declara no `join` (ADR 0147 ponto 1,
 * RN-514). Até aqui o join era mudo dos dois lados — `socket.channel(topic,
 * {})` — e o servidor não tinha como saber se o binário do outro lado
 * entende uma mensagem nova. O defeito que isso produz é o pior possível: a
 * mensagem chega, o handler não existe, e nada acontece — sem erro, sem log.
 *
 * A lista é o que este runner SABE FAZER de verdade, e nada além:
 *
 * - `exec` — comando já aprovado, o par `exec`/`exec_result` (ADR 0104);
 * - `pty` — terminal interativo, `pty_*` (ADR 0103, `pty.ts`).
 * - `espelho` — copiar o trabalho para a pasta que o usuário declarou, fora
 *   da base montada (`mirror_sync`, `espelho.ts`/`espelho-guard.ts`, ADR 0147
 *   ponto 2, RN-516).
 *
 * `espelho` entrou nesta lista SÓ AGORA, e só porque passou a existir de
 * verdade no binário. Ela ficou de fora enquanto era nome no vocabulário do
 * servidor e nada mais (RN-514): declarar o que não se implementa é
 * exatamente o defeito que a negociação existe para impedir — o servidor
 * concederia, entregaria a mensagem, e ela sumiria do mesmo jeito.
 *
 * O servidor IGNORA nome que não conhece (runner mais novo que o engine
 * conecta) e RECUSA o join, nomeando a que falta, quando o projeto exige uma
 * que não está aqui — recusa que `index.ts` já trata como fatal, sem retry.
 * Desde a RN-516 essa recusa tem o primeiro caso REAL: projeto com
 * `mirror_path` não-nulo exige `espelho`, e um binário anterior a esta
 * versão deixa de conectar nele até ser atualizado. É opt-in — só acontece
 * onde alguém configurou um destino — e o custo está declarado no ADR 0147.
 */
export const CAPACIDADES_DO_RUNNER = ['exec', 'pty', 'espelho'] as const;

/**
 * A QUARTA capacidade (ADR 0151 pontos 3 e 4, RN-532) — criar a pasta de um
 * projeto sob a base local (`workspace_create`).
 *
 * Ela NÃO está em `CAPACIDADES_DO_RUNNER` porque não é incondicional: as três
 * de lá este binário sabe fazer sempre, e esta depende de haver uma BASE
 * consentida nesta execução (RN-529). Um runner sem base não tem onde criar
 * pasta nenhuma, e declarar a capacidade mesmo assim seria exatamente o
 * defeito que a negociação existe para impedir — a mensagem chegaria, o
 * trabalho não aconteceria, e o servidor teria concedido com base numa
 * afirmação falsa.
 *
 * Consequência declarada, e é o desenho: **a declaração desta capacidade É o
 * que o servidor sabe sobre a base**. O engine não lê o disco do usuário e não
 * tem tabela de bases — a segunda pré-condição do predicado dele
 * (`Engine.Runners.PastaDoProjeto`) é respondida por esta linha, e por mais
 * nenhuma.
 */
export const CAPACIDADE_DE_WORKSPACE = 'workspace';

/**
 * O que ESTE processo declara no `join`, DADA a base desta execução — as três
 * incondicionais, mais `workspace` quando há base.
 *
 * É por isso que a capacidade é da CONEXÃO e não do binário: o mesmo executável
 * declara conjuntos diferentes conforme foi consentida uma base ou não, e o
 * servidor guarda o resultado em `socket.assigns`, nunca em tabela (ADR 0147).
 */
export function capacidadesDoRunner(base: string | null): string[] {
  const declaradas: string[] = [...CAPACIDADES_DO_RUNNER];
  if (base) declaradas.push(CAPACIDADE_DE_WORKSPACE);
  return declaradas;
}

export interface ConectarCanalOpts {
  engineWsUrl: string;
  ticket: string;
  projectId: string;
  handlers: RunnerChannelHandlers;
  /**
   * O que declarar no `join`. Default: `CAPACIDADES_DO_RUNNER` (as três
   * incondicionais) — quem tem base passa `capacidadesDoRunner(base)`.
   */
  capacidades?: readonly string[];
  /** Injetável para teste — default é a `Socket` real da lib `phoenix`. */
  criarSocket?: CriarSocket;
}

export interface CanalConectado {
  socket: SocketLike;
  channel: ChannelLike;
  /**
   * O que o servidor concedeu para `espelho` NESTA conexão, ou `null` —
   * `null` é o estado NORMAL (projeto sem destino declarado é a maioria).
   * Ver `EspelhoConcedido`.
   */
  espelho: EspelhoConcedido | null;
  /** Encerra a conexão de propósito (não deve disparar reconexão do chamador). */
  desconectar(): void;
}

/**
 * Lê o destino do espelho da resposta do `join`. Tudo que não for um
 * `%{espelho: %{destino: "<string não-vazia>"}}` vira `null` — inclusive a
 * resposta vazia de um engine anterior a esta versão. "Não veio destino" e
 * "não há destino" são a mesma coisa para este runner, e as duas terminam no
 * mesmo lugar: `mirror_sync` recusado, nunca uma cópia às cegas.
 */
export function espelhoConcedidoDaResposta(resp: unknown): EspelhoConcedido | null {
  if (typeof resp !== 'object' || resp === null) return null;
  const espelho = (resp as { espelho?: unknown }).espelho;
  if (typeof espelho !== 'object' || espelho === null) return null;
  const destino = (espelho as { destino?: unknown }).destino;
  if (typeof destino !== 'string' || destino.length === 0) return null;
  return { destino };
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

      // Os params do join deixaram de ser vazios (RN-514): é aqui que este
      // binário declara o que sabe fazer. Cópia mutável do `as const` —
      // atravessa a rede como JSON.
      const canal = socket.channel(`terminal:${projectId}`, {
        capacidades: [...(opts.capacidades ?? CAPACIDADES_DO_RUNNER)],
      });

      canal
        .join()
        .receive('ok', (resp: unknown) => {
          registrarHandlers(canal, handlers);
          resolvePromise({
            socket,
            channel: canal,
            // O destino do espelho viaja DENTRO da concessão do join, nunca em
            // configuração deste processo (ADR 0147 ponto 4).
            espelho: espelhoConcedidoDaResposta(resp),
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

/** `true` só para um objeto plano de string->string — nunca `null`/array/tipo misto. */
function envValido(valor: unknown): valor is Record<string, string> {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    !Array.isArray(valor) &&
    Object.values(valor).every((v) => typeof v === 'string')
  );
}

function registrarHandlers(canal: ChannelLike, handlers: RunnerChannelHandlers): void {
  canal.on('exec', (payload: unknown) => {
    const msg = payload as Partial<ExecMessage>;
    if (
      typeof msg?.ref === 'string' &&
      typeof msg.command === 'string' &&
      typeof msg.cwd === 'string'
    ) {
      // `env` é opcional e só aceito quando é um objeto de string->string de
      // verdade — nunca repassado cru: um payload malformado não deveria
      // virar env arbitrário do processo filho.
      const env = envValido(msg.env) ? msg.env : undefined;
      handlers.onExec({ ref: msg.ref, command: msg.command, cwd: msg.cwd, env });
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

  canal.on('container_start', (payload: unknown) => {
    const msg = payload as Partial<ContainerStartMessage>;
    if (typeof msg?.ref === 'string' && msg.spec !== undefined && msg.spec !== null) {
      handlers.onContainerStart({ ref: msg.ref, spec: msg.spec as ContainerSpecPayload });
    }
  });

  canal.on('container_stop', (payload: unknown) => {
    const msg = payload as Partial<ContainerStopMessage>;
    if (typeof msg?.ref === 'string' && typeof msg.workspaceDirName === 'string') {
      handlers.onContainerStop({ ref: msg.ref, workspaceDirName: msg.workspaceDirName });
    }
  });

  canal.on('container_remove', (payload: unknown) => {
    const msg = payload as Partial<ContainerRemoveMessage>;
    if (typeof msg?.ref === 'string' && typeof msg.workspaceDirName === 'string') {
      handlers.onContainerRemove({ ref: msg.ref, workspaceDirName: msg.workspaceDirName });
    }
  });

  // `destino` é OBRIGATÓRIO no payload — sem ele não há o que conferir contra
  // a concessão do join, e "sincronize para o destino que você achar" é
  // exatamente a forma que este protocolo não pode ter. `momento` é rastro:
  // ausente vira `"desconhecido"` em vez de descartar a mensagem.
  canal.on('mirror_sync', (payload: unknown) => {
    const msg = payload as Partial<MirrorSyncMessage>;
    if (typeof msg?.ref === 'string' && typeof msg.destino === 'string') {
      handlers.onMirrorSync({
        ref: msg.ref,
        destino: msg.destino,
        momento: typeof msg.momento === 'string' ? msg.momento : 'desconhecido',
      });
    }
  });

  // `projectId` e `segmento` são OBRIGATÓRIOS: sem os dois não há pedido, e
  // "crie a pasta que você achar" é exatamente a forma que este protocolo não
  // pode ter. `repoUrl` ausente é `git init` (o caso do projeto novo);
  // `env` passa pelo MESMO filtro do `exec`, para um payload malformado nunca
  // virar ambiente arbitrário do processo filho.
  canal.on('workspace_create', (payload: unknown) => {
    const msg = payload as Partial<WorkspaceCreateMessage>;
    if (
      typeof msg?.ref === 'string' &&
      typeof msg.projectId === 'string' &&
      typeof msg.segmento === 'string'
    ) {
      handlers.onWorkspaceCreate({
        ref: msg.ref,
        projectId: msg.projectId,
        segmento: msg.segmento,
        repoUrl: typeof msg.repoUrl === 'string' ? msg.repoUrl : undefined,
        env: envValido(msg.env) ? msg.env : undefined,
      });
    }
  });
}

export function enviarExecResult(canal: ChannelLike, msg: ExecResultMessage): void {
  canal.push('exec_result', msg);
}

/**
 * RN-423 (ADR 0104) — empurrado UMA vez, logo depois do join resolver `ok`
 * (ver `index.ts`). O engine repassa pra api, que revalida léxico e
 * SOBRESCREVE `workspacePath` — este runner é a fonte da verdade do
 * caminho, não só um aviso decorativo.
 */
export function enviarWorkspaceConfirm(
  canal: ChannelLike,
  msg: WorkspaceConfirmMessage,
): void {
  canal.push('workspace_confirm', msg);
}

/**
 * ADR 0151 ponto 3 (RN-532) — o desfecho do `workspace_create`, correlacionado
 * pelo MESMO `ref` que veio no pedido. Ao contrário de `mirror_sync_result`,
 * aqui há alguém BLOQUEADO esperando do outro lado (o molde de
 * `exec_result`/`container_start_result`), e por isso ele nunca pode deixar de
 * ser enviado: sem ele o pedinte veria um TIMEOUT no lugar da causa.
 */
export function enviarWorkspaceCreateResult(
  canal: ChannelLike,
  msg: WorkspaceCreateResultMessage,
): void {
  canal.push('workspace_create_result', msg);
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

export function enviarContainerStartResult(
  canal: ChannelLike,
  msg: ContainerStartResultMessage,
): void {
  canal.push('container_start_result', msg);
}

export function enviarContainerStopResult(
  canal: ChannelLike,
  msg: ContainerStopResultMessage,
): void {
  canal.push('container_stop_result', msg);
}

export function enviarContainerRemoveResult(
  canal: ChannelLike,
  msg: ContainerRemoveResultMessage,
): void {
  canal.push('container_remove_result', msg);
}

/**
 * RN-517 (ADR 0147 ponto 7) — o desfecho da rodada do espelho, na MESMA forma
 * de `workspace_confirm`: o runner contando algo sobre si mesmo, sem que
 * ninguém esteja esperando. O engine repassa pra api, que grava numa tabela
 * própria; falha lá do outro lado nunca volta pra cá, e é assim que
 * telemetria não derruba o que ela mede.
 */
export function enviarMirrorSyncResult(
  canal: ChannelLike,
  msg: MirrorSyncResultMessage,
): void {
  canal.push('mirror_sync_result', msg);
}

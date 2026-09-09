import { Socket } from 'phoenix';
import { logger } from './logger';
import { getTerminalTicket } from './api-client';
import type {
  DiretorioInicialResultado,
  FsBrowser,
  ListagemResultado,
  MotivoDeFalhaDoAgente,
} from './fs-browser';

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

/**
 * A interface e os tipos MORAM em `fs-browser.ts` desde a RN-504 — este
 * módulo passou a ser UMA das duas implementações dela, e o tipo não pode
 * morar dentro de uma delas. `diretorioInicial()` aqui é `os.homedir()` do
 * RUNNER; no transporte de api é a base de projetos montados.
 *
 * Os campos `arquivos`/`simbolicos`/`truncado` de `ListagemResultado` são
 * opcionais e este transporte NÃO os preenche: o protocolo do runner
 * (`FsEntrada` em `apps/runner/src/channel.ts`) devolve pasta e arquivo
 * misturados na mesma lista e não conta nada. Preencher com `0` seria
 * afirmar que não há nada de fora, que é diferente de não saber.
 */
export type {
  DiretorioInicialResultado,
  FsBrowser,
  FsEntrada,
  ListagemResultado,
  MotivoDeFalhaDoAgente,
} from './fs-browser';

/**
 * A frase com que o engine anuncia "não há runner conectado a este projeto"
 * (`terminal_channel.ex`, nos dois handlers de `fs_*`).
 *
 * O casamento por SUBSTRING mora aqui, e só aqui — este módulo é o dono do
 * protocolo do canal, e traduzir a resposta do engine para o vocabulário do
 * `FsBrowser` é o trabalho dele. Antes da RN-533 quem casava era o
 * `FolderBrowserModal`, ou seja: um componente de tela decidindo por uma frase
 * em pt-BR escrita num arquivo `.ex` do engine.
 *
 * O conserto DEFINITIVO é o engine mandar um código ao lado do texto, como o
 * runner já faz com os cinco `motivo` da RN-532 — mas o engine está fora do
 * escopo desta entrega, e a lacuna fica declarada aqui em vez de escondida.
 * Enquanto isso a degradação é benigna e nomeada: mudar a frase no engine faz
 * a falha cair em `sem-resposta` (o estado "não sei"), nunca em "há agente".
 */
const FRASE_DO_ENGINE_SEM_RUNNER = 'Nenhum runner conectado';

function motivoDaMensagem(erro: string | undefined): MotivoDeFalhaDoAgente {
  return erro?.includes(FRASE_DO_ENGINE_SEM_RUNNER) ? 'sem-agente' : 'sem-resposta';
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

export function connectFsBrowserChannel(projectId: string): FsBrowser {
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

  // Toda falha DESTE lado — teto da requisição, socket caído, ticket recusado,
  // join reprovado — é `sem-resposta`: nenhuma delas prova que não há agente,
  // e afirmar que não há seria a tela decidindo o que não sabe (RN-088/RN-468).
  // `sem-agente` só nasce da resposta do engine, que sabe.
  function resolverComErro(
    ref: string,
    mensagem: string,
    motivo: MotivoDeFalhaDoAgente = 'sem-resposta',
  ) {
    const pendente = pendentes.get(ref);
    if (!pendente) return;
    pendentes.delete(ref);
    clearTimeout(pendente.temporizador);
    if (pendente.tipo === 'list') {
      pendente.resolve({ path: pendente.path, entradas: [], erro: mensagem, motivo });
    } else {
      pendente.resolve({ erro: mensagem, motivo });
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

    // `engineWsUrl` já é o endpoint FINAL do socket, pronto de
    // `engineWsUrlPublico()` — `ws(s)://host:porta/runner`. Concatenar
    // `/runner/websocket` aqui era o MESMO bug que a RN-433 já tinha achado
    // e corrigido no `terminal-channel.ts` irmão: duplicava o `/runner` que
    // o endpoint já carrega E antecipava o `/websocket` que o PRÓPRIO
    // `Socket` do phoenix.js acrescenta sozinho no construtor
    // (`this.endPoint = \`${endPoint}/websocket\``) — o engine via `GET
    // /runner/runner/websocket/websocket` e recusava a conexão, então o
    // canal caía direto em "A conexão com o runner caiu". Achado navegando
    // de verdade ao verificar a RN-437 (criação antecipada do projeto
    // `runner`) — antes desta correção, `FolderBrowserModal` nunca tinha
    // sido exercitado contra um engine real neste caminho.
    const wsUrl = engineWsUrl.replace(/^http/, 'ws');
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
        ...(msg.erro ? { motivo: motivoDaMensagem(msg.erro) } : {}),
      });
    });

    canal.on('fs_home_dir_reply', (payload: unknown) => {
      const msg = payload as Partial<DiretorioInicialResultado> & { ref?: string };
      if (typeof msg?.ref !== 'string') return;
      const pendente = pendentes.get(msg.ref);
      if (!pendente || pendente.tipo !== 'home') return;
      pendentes.delete(msg.ref);
      clearTimeout(pendente.temporizador);
      pendente.resolve({
        path: msg.path,
        erro: msg.erro,
        ...(msg.erro ? { motivo: motivoDaMensagem(msg.erro) } : {}),
      });
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
        return Promise.resolve({
          path,
          entradas: [],
          erro: erroDeConexao,
          motivo: 'sem-resposta' as const,
        });
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
        return Promise.resolve({ erro: erroDeConexao, motivo: 'sem-resposta' as const });
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

/**
 * A superfície HTTP do broker: `/health` e as CINCO operações. Nada mais.
 *
 * ## O roteador é uma FUNÇÃO, e o `node:http` é um invólucro
 *
 * `tratar()` recebe um pedido já normalizado (`{ metodo, caminho, token,
 * corpo }`) e devolve `{ status, corpo }`. Todo o teste deste pacote fala com
 * ela — sem socket, sem daemon, sem api. O invólucro (`criarServidor`) só
 * traduz `IncomingMessage`/`ServerResponse` para esses dois tipos, e é a única
 * parte que nenhum teste cobre, de propósito: ela não decide nada.
 *
 * ## A tabela de status é a classificação de falha, escrita uma vez
 *
 * Cada erro do produto já declara a própria ORIGEM (`infra | modelo | codigo |
 * politica`) — a convenção do repositório desde o ADR 0020, e a razão de nunca
 * haver diagnóstico por eliminação. Aqui essa origem VAI NA RESPOSTA, ao lado
 * do status: quem chama (a api) não precisa reconhecer mensagem para saber se
 * o conserto é reiniciar um daemon, decidir uma imagem ou corrigir código.
 *
 * `ComandoDeDockerFalhouError` é o único que NÃO declara origem, e isso é
 * deliberado no ADR 0128: imagem inexistente, disco cheio e nome em uso chegam
 * pelo mesmo canal, e escolher uma origem ali seria adivinhar. A resposta
 * repassa `origem: null` em vez de inventar uma.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  ComandoDeDockerFalhouError,
  ContainerAusenteError,
  ContainerNaoGerenciadoError,
  DockerCliAusenteError,
  DockerIndisponivelError,
  EspecificacaoInvalidaError,
} from '@brabo/docker-port';
import {
  ApiIndisponivelError,
  CABECALHO_SERVICE_TOKEN,
  IdDeProjetoInvalidoError,
  ProjetoDesconhecidoError,
} from './api-client.ts';
import { tokenConfere } from './config.ts';
import {
  ComandoInvalidoError,
  DiretorioForaDoEscopoError,
  exec,
  inspect,
  ModoDeExecucaoNaoSuportadoError,
  RaizDeWorkspacesNaoConfiguradaError,
  remove,
  SemDecisaoDeImagemError,
  start,
  stop,
  type DependenciasDoBroker,
} from './operacoes.ts';

/** Teto do corpo aceito. Um `exec` manda um comando, nunca um arquivo. */
export const TETO_DE_CORPO_BYTES = 64 * 1024;

export interface PedidoNormalizado {
  metodo: string;
  caminho: string;
  /** O que veio no cabeçalho de service token, ou `null`. */
  token: string | null;
  corpo: unknown;
}

export interface RespostaDoBroker {
  status: number;
  corpo: unknown;
}

/**
 * `/health` é a ÚNICA rota sem token, pelo mesmo motivo que `/health` da api e
 * do engine são públicas: quem a consulta é o healthcheck do Compose/do
 * orquestrador, que não tem credencial e não pode ter. Ela responde se o
 * PROCESSO está de pé — nunca se o daemon está, que é outra pergunta e tem
 * resposta em `inspect`. Confundir as duas faria o orquestrador reiniciar este
 * serviço por causa de um Docker fora do ar, que reiniciar não conserta.
 */
export async function tratar(
  deps: DependenciasDoBroker,
  pedido: PedidoNormalizado,
): Promise<RespostaDoBroker> {
  if (pedido.caminho === '/health' && pedido.metodo === 'GET') {
    return { status: 200, corpo: { status: 'ok', servico: 'broker' } };
  }

  if (pedido.token === null || !tokenConfere(pedido.token, deps.config)) {
    // 401 e não 403, como o `VerifyServiceToken` do engine: o que falta é
    // AUTENTICAÇÃO do chamador. A api usa 403 na direção oposta por uma
    // restrição de compatibilidade documentada lá, não por discordância.
    return {
      status: 401,
      corpo: {
        erro: 'token de serviço inválido ou ausente',
        origem: 'politica',
      },
    };
  }

  const rota = rotaDeContainer(pedido.caminho);
  if (rota === null) {
    return { status: 404, corpo: { erro: 'rota desconhecida', origem: 'politica' } };
  }

  try {
    return await despachar(deps, pedido, rota);
  } catch (erro) {
    return respostaDeErro(erro);
  }
}

interface RotaDeContainer {
  projectId: string;
  /** `''` para `/containers/:id`, ou `start`/`stop`/`remove`/`exec`. */
  operacao: string;
}

/**
 * `/containers/:projectId[/<operacao>]` — e nada mais casa. O roteador é uma
 * lista fechada de propósito: um roteador por expressão regular genérica é
 * onde uma sexta operação entra sem ninguém decidir que ela existe.
 */
export function rotaDeContainer(caminho: string): RotaDeContainer | null {
  const partes = caminho.split('?')[0]?.split('/').filter((p) => p.length > 0) ?? [];
  if (partes[0] !== 'containers') return null;
  const projectId = partes[1];
  if (projectId === undefined) return null;
  if (partes.length === 2) return { projectId, operacao: '' };
  if (partes.length === 3 && partes[2] !== undefined) {
    return { projectId, operacao: partes[2] };
  }
  return null;
}

async function despachar(
  deps: DependenciasDoBroker,
  pedido: PedidoNormalizado,
  rota: RotaDeContainer,
): Promise<RespostaDoBroker> {
  const { projectId, operacao } = rota;

  if (operacao === '' && pedido.metodo === 'GET') {
    // A leitura devolve `{ observado }` e nunca o objeto cru: `null` é resposta
    // legítima (não há container), e um corpo que às vezes é objeto e às vezes
    // é `null` obriga quem lê a distinguir isso do corpo vazio de um erro.
    return { status: 200, corpo: { observado: await inspect(deps, projectId) } };
  }

  if (pedido.metodo !== 'POST') {
    return { status: 405, corpo: { erro: 'método não permitido', origem: 'politica' } };
  }

  switch (operacao) {
    case 'start':
      return { status: 200, corpo: await start(deps, projectId) };
    case 'stop':
      await stop(deps, projectId);
      return { status: 200, corpo: { parado: true } };
    case 'remove':
      await remove(deps, projectId);
      return { status: 200, corpo: { removido: true } };
    case 'exec':
      return { status: 200, corpo: await exec(deps, projectId, pedido.corpo) };
    default:
      return {
        status: 404,
        corpo: {
          erro:
            `operação "${operacao}" não existe. São cinco: start, stop, ` +
            'remove, exec e a leitura (GET). Uma sexta é decisão de produto ' +
            'com ADR, nunca um parâmetro a mais',
          origem: 'politica',
        },
      };
  }
}

/**
 * A tabela. Cada linha é uma classe de erro NOMEADA — nenhuma classificação
 * sai de substring de mensagem, que é o que o ADR 0002/0041 já proíbem nos
 * outros dois fornecedores externos (git e LLM).
 */
export function respostaDeErro(erro: unknown): RespostaDoBroker {
  if (erro instanceof DockerIndisponivelError || erro instanceof DockerCliAusenteError) {
    // 503: o serviço existe, a dependência dele não respondeu. Reiniciar o
    // broker não conserta nenhum dos dois, e o corpo diz o que conserta.
    return { status: 503, corpo: corpo(erro, 'infra') };
  }
  if (erro instanceof ApiIndisponivelError) {
    return { status: 502, corpo: corpo(erro, 'infra') };
  }
  if (erro instanceof RaizDeWorkspacesNaoConfiguradaError) {
    return { status: 503, corpo: corpo(erro, 'infra') };
  }
  if (erro instanceof ProjetoDesconhecidoError) {
    return { status: 404, corpo: corpo(erro, 'politica') };
  }
  if (
    erro instanceof ContainerNaoGerenciadoError ||
    erro instanceof ContainerAusenteError ||
    erro instanceof SemDecisaoDeImagemError ||
    erro instanceof ModoDeExecucaoNaoSuportadoError
  ) {
    // 409: o pedido é legível e o estado do mundo não permite atendê-lo.
    return { status: 409, corpo: corpo(erro, 'politica') };
  }
  if (
    erro instanceof EspecificacaoInvalidaError ||
    erro instanceof ComandoInvalidoError ||
    erro instanceof DiretorioForaDoEscopoError ||
    erro instanceof IdDeProjetoInvalidoError
  ) {
    // 422: o pedido chegou inteiro e o CONTEÚDO foi recusado.
    return { status: 422, corpo: corpo(erro, 'politica') };
  }
  if (erro instanceof ComandoDeDockerFalhouError) {
    // Sem origem, de propósito (ADR 0128): imagem inexistente, disco cheio e
    // nome em uso chegam pelo mesmo canal, e escolher uma seria adivinhar.
    return {
      status: 502,
      corpo: { erro: erro.message, origem: null, exitCode: erro.exitCode },
    };
  }
  return {
    status: 500,
    corpo: {
      erro: erro instanceof Error ? erro.message : String(erro),
      origem: 'codigo',
    },
  };
}

function corpo(erro: Error, origem: string): Record<string, unknown> {
  return { erro: erro.message, origem };
}

/**
 * O invólucro `node:http`. Só normaliza e serializa — toda decisão está em
 * `tratar`. Sem framework: são seis rotas, e uma dependência de servidor web
 * aqui seria superfície nova num processo que fala com o Docker do host.
 */
export function criarServidor(deps: DependenciasDoBroker): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      let resposta: RespostaDoBroker;
      try {
        resposta = await tratar(deps, await normalizar(req));
      } catch (erro) {
        resposta = respostaDeErro(erro);
      }
      const json = JSON.stringify(resposta.corpo ?? null);
      res.writeHead(resposta.status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(json),
      });
      res.end(json);
    })();
  });
}

export class CorpoGrandeDemaisError extends Error {
  readonly origem = 'politica';

  constructor() {
    super(
      `corpo maior que ${TETO_DE_CORPO_BYTES} bytes. Um \`exec\` manda um ` +
        'comando, nunca um arquivo.',
    );
    this.name = 'CorpoGrandeDemaisError';
  }
}

async function normalizar(req: IncomingMessage): Promise<PedidoNormalizado> {
  const cabecalho = req.headers[CABECALHO_SERVICE_TOKEN];
  const token = Array.isArray(cabecalho) ? (cabecalho[0] ?? null) : (cabecalho ?? null);

  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of req) {
    const buffer = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(String(pedaco));
    total += buffer.byteLength;
    if (total > TETO_DE_CORPO_BYTES) throw new CorpoGrandeDemaisError();
    pedacos.push(buffer);
  }

  const bruto = Buffer.concat(pedacos).toString('utf8');
  let corpoLido: unknown = undefined;
  if (bruto.trim().length > 0) {
    try {
      corpoLido = JSON.parse(bruto);
    } catch {
      // Corpo ilegível vira `undefined`, e quem precisa dele recusa nomeando o
      // campo que falta. Um erro de parse aqui diria "JSON inválido" sem dizer
      // o que a rota esperava.
      corpoLido = undefined;
    }
  }

  return {
    metodo: req.method ?? 'GET',
    caminho: req.url ?? '/',
    token,
    corpo: corpoLido,
  };
}

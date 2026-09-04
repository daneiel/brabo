/**
 * As CINCO operações do broker. Não seis.
 *
 * A porta (`packages/docker-port`) já contém o que se pode PEDIR ao daemon;
 * este arquivo contém o que se pode pedir ao BROKER, e a diferença entre os
 * dois é a única coisa que importa aqui: nenhuma destas funções recebe
 * especificação. Todas recebem `projectId` e vão buscar o resto.
 *
 * Uma sexta operação — `run`, `pull`, `build`, ou qualquer coisa que aceite
 * spec pronta do chamador — é decisão de produto com ADR, nunca um parâmetro a
 * mais. O mesmo vale para um campo novo no corpo de `exec`: se a resposta para
 * "como faço X?" for "acrescento um campo", a pergunta certa é se X devia
 * existir.
 *
 * ## Por que este arquivo não conhece HTTP
 *
 * Ele recebe `DependenciasDoBroker` e devolve valor ou lança. Quem traduz isso
 * em status e corpo JSON é `servidor.ts`. A separação existe para o teste
 * exercitar as cinco operações sem socket, sem daemon e sem api — os três
 * substituídos por duplos.
 */

import {
  especificacaoValidada,
  nomeDeWorkspaceValidado,
  PONTO_DE_MONTAGEM,
  type ContainerIniciado,
  type DockerPort,
  type EspecificacaoDeContainer,
  type EstadoObservadoDoContainer,
  type PedidoDeExec,
  type ResultadoDeExec,
} from '@brabo/docker-port';
import type { BuscarContexto, ContextoDoProjeto } from './api-client.ts';
import type { ConfiguracaoDoBroker } from './config.ts';

export interface DependenciasDoBroker {
  docker: DockerPort;
  buscarContexto: BuscarContexto;
  config: ConfiguracaoDoBroker;
}

/**
 * O projeto não sobe container do SERVIDOR. Hoje isso quer dizer
 * `mounted`/`runner`: o código deles mora numa pasta do usuário que o host
 * deste broker não enxerga, e quem sobe container nesse caso é o runner, na
 * máquina de quem tem a pasta.
 *
 * Origem `politica`: é a mesma regra que `RegistrarTransicaoDeContainerUseCase`
 * já aplica do lado da api, dita onde o broker consegue dizê-la. O PR do portão
 * nos três modos (1.7) revisita as duas ao mesmo tempo — mudar só uma delas
 * agora deixaria a api e o broker discordando sobre o que existe.
 */
export class ModoDeExecucaoNaoSuportadoError extends Error {
  readonly origem = 'politica';
  readonly executionMode: string;

  constructor(projectId: string, executionMode: string) {
    super(
      `o projeto ${projectId} está no modo "${executionMode}" e não sobe ` +
        'container no servidor. Em `mounted`/`runner` o código mora numa ' +
        'pasta do usuário que esta máquina não enxerga — quem sobe o ' +
        'container é o runner, do lado de lá.',
    );
    this.name = 'ModoDeExecucaoNaoSuportadoError';
    this.executionMode = executionMode;
  }
}

/**
 * O Arquiteto ainda não decidiu a imagem (RN-105). Origem `politica`: é o
 * portão funcionando, não uma falha — e a mensagem diz o que falta acontecer,
 * porque quem a lê é quem opera.
 */
export class SemDecisaoDeImagemError extends Error {
  readonly origem = 'politica';

  constructor(projectId: string) {
    super(
      `o Arquiteto ainda não decidiu a imagem do projeto ${projectId} ` +
        '(RN-105) — não há o que subir. A decisão nasce como artefato ' +
        '`artifact.project_image`, versionada, na sessão dele.',
    );
    this.name = 'SemDecisaoDeImagemError';
  }
}

/**
 * `PROJECT_WORKSPACES_HOST_ROOT` não está configurada. Origem `infra`: falta
 * uma peça do AMBIENTE, e a mensagem diz qual — nunca um mount adivinhado.
 *
 * Adivinhar aqui teria um custo específico e silencioso: o daemon criaria a
 * pasta VAZIA no host e a montaria vazia no container, e o dev agent
 * trabalharia num diretório sem código sem nada indicar por quê.
 */
export class RaizDeWorkspacesNaoConfiguradaError extends Error {
  readonly origem = 'infra';

  constructor() {
    super(
      'PROJECT_WORKSPACES_HOST_ROOT não está definida neste broker. Ela é o ' +
        'caminho das pastas de projeto NO HOST (não dentro deste container) — ' +
        'o `-v` de um `docker run` é interpretado pelo daemon, que enxerga o ' +
        'filesystem do host. Sem ela eu montaria uma pasta vazia e ninguém ' +
        'saberia por quê, então recuso. Nenhum container foi tocado.',
    );
    this.name = 'RaizDeWorkspacesNaoConfiguradaError';
  }
}

/**
 * `cwd` de `exec` fora de `/work`. Origem `politica`.
 *
 * O container não é fronteira de caminho por si só — o docblock de
 * `PedidoDeExec` diz isso, e diz que quem manda `cwd` deve a validação de
 * escopo do lado de fora. Este É o lado de fora, para o caminho do servidor.
 */
export class DiretorioForaDoEscopoError extends Error {
  readonly origem = 'politica';
  readonly cwd: string;

  constructor(cwd: string) {
    super(
      `cwd ${JSON.stringify(cwd)} está fora de ${PONTO_DE_MONTAGEM}. O único ` +
        'lugar do container que corresponde ao projeto é esse — executar ' +
        'fora dele seria executar no sistema de arquivos da imagem.',
    );
    this.name = 'DiretorioForaDoEscopoError';
    this.cwd = cwd;
  }
}

export class ComandoInvalidoError extends Error {
  readonly origem = 'politica';

  constructor(motivo: string) {
    super(`comando recusado: ${motivo}.`);
    this.name = 'ComandoInvalidoError';
  }
}

/** Sobe o container do projeto. Idempotente — ver `DockerPort.start`. */
export async function start(
  deps: DependenciasDoBroker,
  projectId: string,
): Promise<ContainerIniciado> {
  const spec = await especificacaoDoProjeto(deps, projectId);
  return deps.docker.start(spec);
}

export async function stop(
  deps: DependenciasDoBroker,
  projectId: string,
): Promise<void> {
  await deps.docker.stop(await nomeDaPasta(deps, projectId));
}

export async function remove(
  deps: DependenciasDoBroker,
  projectId: string,
): Promise<void> {
  await deps.docker.remove(await nomeDaPasta(deps, projectId));
}

export async function inspect(
  deps: DependenciasDoBroker,
  projectId: string,
): Promise<EstadoObservadoDoContainer | null> {
  return deps.docker.inspect(await nomeDaPasta(deps, projectId));
}

export async function exec(
  deps: DependenciasDoBroker,
  projectId: string,
  pedido: unknown,
): Promise<ResultadoDeExec> {
  const nome = await nomeDaPasta(deps, projectId);
  return deps.docker.exec(nome, pedidoDeExecValidado(pedido));
}

/**
 * O PARSE do corpo de `exec`. Fechado como o resto: um campo a mais no JSON é
 * ignorado, nunca repassado — o `PedidoDeExec` é montado campo a campo aqui, e
 * é ele que a porta recebe.
 */
export function pedidoDeExecValidado(bruto: unknown): PedidoDeExec {
  const corpo = (bruto ?? {}) as Record<string, unknown>;

  const comando = corpo.comando;
  if (typeof comando !== 'string' || comando.trim().length === 0) {
    throw new ComandoInvalidoError('`comando` precisa ser texto não vazio');
  }

  const cwd = corpo.cwd;
  if (cwd !== undefined && cwd !== null) {
    if (typeof cwd !== 'string') {
      throw new ComandoInvalidoError('`cwd`, quando presente, é texto');
    }
    if (!dentroDoPontoDeMontagem(cwd)) {
      throw new DiretorioForaDoEscopoError(cwd);
    }
  }

  return {
    comando,
    cwd: typeof cwd === 'string' ? cwd : undefined,
    timeoutMs: numeroOpcional(corpo.timeoutMs, 'timeoutMs'),
    maxBytes: numeroOpcional(corpo.maxBytes, 'maxBytes'),
  };
}

/**
 * `/work`, `/work/sub` — sim. `/worktree`, `/work/../etc`, `work` — não. A
 * checagem é LÉXICA e o separador é obrigatório: `startsWith('/work')` sozinho
 * aceitaria `/workspace`, que é outro diretório.
 */
function dentroDoPontoDeMontagem(cwd: string): boolean {
  if (cwd.includes('\0')) return false;
  if (cwd.split('/').some((segmento) => segmento === '..')) return false;
  const semBarraFinal = cwd.replace(/\/+$/, '') || '/';
  return (
    semBarraFinal === PONTO_DE_MONTAGEM ||
    semBarraFinal.startsWith(`${PONTO_DE_MONTAGEM}/`)
  );
}

function numeroOpcional(valor: unknown, campo: string): number | undefined {
  if (valor === undefined || valor === null) return undefined;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ComandoInvalidoError(
      `\`${campo}\`, quando presente, é número positivo`,
    );
  }
  return n;
}

/**
 * O que as QUATRO operações que não são `start` precisam: o nome da pasta,
 * validado. Elas não pedem imagem nem recursos de propósito — exigir decisão
 * do Arquiteto para PARAR ou para OLHAR um container deixaria um container
 * órfão inalcançável justamente quando a decisão fosse revogada.
 */
async function nomeDaPasta(
  deps: DependenciasDoBroker,
  projectId: string,
): Promise<string> {
  const contexto = await deps.buscarContexto(projectId);
  garantirModoContainer(projectId, contexto);
  return nomeDeWorkspaceValidado(contexto.workspaceDirName);
}

/**
 * A composição — o coração deste serviço.
 *
 * Tudo o que vira `docker run` sai daqui, e daqui só sai o que a api disse
 * sobre o PROJETO mais o que este processo sabe sobre a MÁQUINA. Não há um
 * único campo que atravesse a fronteira HTTP do broker até o daemon.
 */
async function especificacaoDoProjeto(
  deps: DependenciasDoBroker,
  projectId: string,
): Promise<EspecificacaoDeContainer> {
  const contexto = await deps.buscarContexto(projectId);
  garantirModoContainer(projectId, contexto);

  if (contexto.imagem === null || contexto.imagem === undefined) {
    throw new SemDecisaoDeImagemError(projectId);
  }

  const raiz = deps.config.raizDeWorkspacesNoHost;
  if (raiz === null) throw new RaizDeWorkspacesNaoConfiguradaError();

  // O nome da pasta é validado DUAS vezes: aqui, para não virar segmento de
  // caminho antes de ser conferido, e dentro de `especificacaoValidada`. A
  // primeira é a que importa — concatenar antes de validar tornaria a segunda
  // uma checagem sobre um caminho já montado.
  const nome = nomeDeWorkspaceValidado(contexto.workspaceDirName);

  return especificacaoValidada({
    workspaceDirName: nome,
    projectId: contexto.projectId,
    projectSlug: contexto.projectSlug,
    workspaceId: contexto.workspaceId,
    imagem: contexto.imagem.image,
    imagemVersao: contexto.imagemVersao,
    rede: contexto.imagem.network,
    raizDoProjeto: `${raiz.replace(/\/+$/, '')}/${nome}`,
    cpus: contexto.imagem.resources?.cpus,
    memoriaMb: contexto.imagem.resources?.memoryMb,
    pidsLimit: contexto.imagem.resources?.pidsLimit,
  });
}

function garantirModoContainer(
  projectId: string,
  contexto: ContextoDoProjeto,
): void {
  if (contexto.executionMode !== 'container') {
    throw new ModoDeExecucaoNaoSuportadoError(
      projectId,
      String(contexto.executionMode),
    );
  }
}

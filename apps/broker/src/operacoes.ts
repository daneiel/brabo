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
  segmentoDeProjetoValidado,
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
 * O projeto não sobe container do SERVIDOR. Desde a RN-503 isso quer dizer
 * `runner`, e só ele: a pasta de um projeto `runner` mora na máquina do
 * usuário, SEM bind-mount, e quem sobe container ali é o `brabo-runner`, do
 * lado de lá (ADR 0137).
 *
 * `mounted` SAIU desta recusa. Ele estava aqui porque a pasta dele era
 * inalcançável pelo daemon deste host — e deixou de ser: o ADR 0141 fez todo
 * projeto montado morar sob UMA base (`BRABO_PROJECTS_BASE`), montada por
 * identidade, e o broker resolve essa base pela raiz própria dele
 * (`BRABO_PROJECTS_HOST_BASE`). A recusa era sobre a GEOMETRIA, não sobre o
 * nome do modo, e a geometria mudou.
 *
 * Origem `politica`: é a mesma regra que a api aplica do lado dela, dita onde o
 * broker consegue dizê-la.
 */
export class ModoDeExecucaoNaoSuportadoError extends Error {
  readonly origem = 'politica';
  readonly executionMode: string;

  constructor(projectId: string, executionMode: string) {
    super(
      `o projeto ${projectId} está no modo "${executionMode}" e não sobe ` +
        'container no servidor. Em `runner` o código mora numa pasta da ' +
        'máquina do usuário, sem bind-mount, que este host não enxerga — ' +
        'quem sobe o container é o brabo-runner, do lado de lá.',
    );
    this.name = 'ModoDeExecucaoNaoSuportadoError';
    this.executionMode = executionMode;
  }
}

/**
 * A api mandou `localizacao.tipo: 'indisponivel'` — ela mesma disse que
 * nenhuma raiz deste servidor alcança a pasta, e o `motivo` veio junto.
 *
 * Erro PRÓPRIO, e não `ModoDeExecucaoNaoSuportadoError` reaproveitado, porque
 * a causa não é o modo: um projeto `mounted` LEGADO, criado antes do ADR 0141
 * e fora da base, cai aqui com o modo certo e a pasta no lugar errado. O
 * conserto é mover a pasta para dentro da base, não trocar de modo — e um erro
 * que dissesse "modo não suportado" mandaria quem opera para o lugar errado.
 */
export class LocalizacaoIndisponivelError extends Error {
  readonly origem = 'politica';

  constructor(projectId: string, motivo: string) {
    super(
      `não sei onde fica a pasta do projeto ${projectId}: ${motivo}. ` +
        'Nenhum container foi tocado.',
    );
    this.name = 'LocalizacaoIndisponivelError';
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
 * `BRABO_PROJECTS_HOST_BASE` não está configurada, e o projeto é `mounted`.
 * Mesmo molde da de cima, e pelo mesmo motivo exato: origem `infra`, a
 * mensagem NOMEIA a variável, e nada é adivinhado.
 *
 * Duas classes e não uma com um parâmetro: quem lê o erro precisa saber QUAL
 * das duas raízes falta, e as duas têm conserto diferente — a de cima pareia
 * com `PROJECT_WORKSPACES_HOST_DIR`, esta deriva de `BRABO_PROJECTS_BASE`
 * (ADR 0141). Um erro genérico obrigaria a ler a spec para descobrir qual.
 */
export class BaseDeProjetosNaoConfiguradaError extends Error {
  readonly origem = 'infra';

  constructor() {
    super(
      'BRABO_PROJECTS_HOST_BASE não está definida neste broker. Ela é a base ' +
        'dos projetos MONTADOS no HOST (não dentro deste container) — no ' +
        'compose ela deriva de `BRABO_PROJECTS_BASE`, que é o caminho que a ' +
        'api e o engine montam por identidade (ADR 0141). Sem ela eu montaria ' +
        'uma pasta vazia e ninguém saberia por quê, então recuso. Nenhum ' +
        'container foi tocado.',
    );
    this.name = 'BaseDeProjetosNaoConfiguradaError';
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
  garantirModoSuportado(projectId, contexto);
  return nomeDeWorkspaceValidado(contexto.workspaceDirName);
}

/**
 * O `-v`, composto: raiz do BROKER + segmento da api.
 *
 * As duas metades vêm de lados diferentes de propósito, e é essa separação que
 * é o invariante do ADR 0130. A api sabe QUAL raiz (`localizacao.tipo`) e sabe
 * o pedaço relativo; ela não sabe — e nunca manda — onde essa raiz fica no
 * HOST. Este processo sabe as duas raízes e não sabe nada sobre o projeto.
 * Nenhum dos dois lados sozinho consegue escrever um caminho arbitrário, e é
 * por isso que a contenção não depende de o chamador estar correto.
 *
 * O resultado ainda passa por `raizDeProjetoValidada` antes de virar `-v` —
 * a terceira barreira, a que recusa `/`, pasta de sistema e `..`. Validar o
 * segmento e não validar a concatenação seria confiar na aritmética de
 * strings.
 */
function raizDoProjetoNoHost(
  deps: DependenciasDoBroker,
  projectId: string,
  contexto: ContextoDoProjeto,
): string {
  const localizacao = contexto.localizacao;
  if (localizacao === null || localizacao === undefined) {
    throw new LocalizacaoIndisponivelError(
      projectId,
      'a api não mandou `localizacao` nenhuma nesta spec',
    );
  }

  if (localizacao.tipo === 'indisponivel') {
    throw new LocalizacaoIndisponivelError(
      projectId,
      localizacao.motivo ?? 'a api não disse por quê',
    );
  }

  const raiz = raizPara(deps, projectId, localizacao.tipo);
  const segmento = segmentoDeProjetoValidado(localizacao.segmento);
  return `${semBarraFinal(raiz)}/${segmento}`;
}

function raizPara(
  deps: DependenciasDoBroker,
  projectId: string,
  tipo: string,
): string {
  if (tipo === 'gerenciada') {
    const raiz = deps.config.raizDeWorkspacesNoHost;
    if (raiz === null) throw new RaizDeWorkspacesNaoConfiguradaError();
    return raiz;
  }
  if (tipo === 'montada') {
    const base = deps.config.baseDeProjetosNoHost;
    if (base === null) throw new BaseDeProjetosNaoConfiguradaError();
    return base;
  }
  // Tipo que este broker não conhece. Recusa NOMEANDO o valor em vez de cair
  // numa raiz default: uma raiz escolhida por omissão é a única forma de a
  // composição errar em silêncio.
  throw new LocalizacaoIndisponivelError(
    projectId,
    `a api mandou \`localizacao.tipo\` ${JSON.stringify(tipo)}, que este ` +
      'broker não sabe resolver contra raiz nenhuma',
  );
}

/** `/a/b/` → `/a/b`. Sem regex: `\/+$/` é a forma de ReDoS que o CodeQL já apontou neste produto. */
function semBarraFinal(caminho: string): string {
  const partes = caminho.split('/').filter((p) => p.length > 0);
  return `/${partes.join('/')}`;
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
  garantirModoSuportado(projectId, contexto);

  if (contexto.imagem === null || contexto.imagem === undefined) {
    throw new SemDecisaoDeImagemError(projectId);
  }

  // O nome da pasta é validado DUAS vezes: aqui, porque ele vira NOME de
  // container, e dentro de `especificacaoValidada`. Ele NÃO é mais o segmento
  // de caminho (RN-503) — quem responde "onde fica a pasta" é `localizacao`,
  // e as duas perguntas passaram a ter respostas diferentes em `mounted`.
  const nome = nomeDeWorkspaceValidado(contexto.workspaceDirName);

  return especificacaoValidada({
    workspaceDirName: nome,
    projectId: contexto.projectId,
    projectSlug: contexto.projectSlug,
    workspaceId: contexto.workspaceId,
    imagem: contexto.imagem.image,
    imagemVersao: contexto.imagemVersao,
    rede: contexto.imagem.network,
    raizDoProjeto: raizDoProjetoNoHost(deps, projectId, contexto),
    cpus: contexto.imagem.resources?.cpus,
    memoriaMb: contexto.imagem.resources?.memoryMb,
    pidsLimit: contexto.imagem.resources?.pidsLimit,
  });
}

/**
 * `container` e `mounted` passam; `runner` não (RN-503).
 *
 * A lista é de PERMITIDOS e não de recusados, e isso é deliberado: um modo
 * novo no enum da api nasceria RECUSADO aqui, com mensagem, em vez de nascer
 * silenciosamente aceito e cair na composição sem raiz que o resolva.
 */
function garantirModoSuportado(
  projectId: string,
  contexto: ContextoDoProjeto,
): void {
  if (
    contexto.executionMode !== 'container' &&
    contexto.executionMode !== 'mounted'
  ) {
    throw new ModoDeExecucaoNaoSuportadoError(
      projectId,
      String(contexto.executionMode),
    );
  }
}

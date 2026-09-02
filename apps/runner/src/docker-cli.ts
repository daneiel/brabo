/**
 * A implementação da `DockerPort` no runner, sobre o CLI `docker` — e ela é o
 * FALLBACK do ADR 0128, escolhido por uma prova que falhou, não por preferência.
 *
 * ## O que foi provado, e o erro exato que decidiu
 *
 * `dockerode` foi instalado em `apps/runner`, importado, instanciado e
 * exercitado (`ping()`) por uma flag de auto-teste rodada contra os artefatos
 * de verdade — não um `import` que o bundler pode apagar. O `tsup`
 * (`pnpm --filter runner build`) passou: ele deixa `dependencies` como
 * `require` externo, então `dockerode` nem entrava no bundle. O
 * `bun build --compile` do ADR 0112 — o terceiro caminho de distribuição, o
 * binário standalone — REPROVOU, na íntegra:
 *
 *     3 | const binding = require('../build/Release/cpufeatures.node');
 *                                 ^
 *     error: Could not resolve: "../build/Release/cpufeatures.node"
 *         at /…/node_modules/.pnpm/cpu-features@0.0.10/node_modules/cpu-features/lib/index.js:3:25
 *
 * A cadeia é obrigatória, não acidental: `dockerode` → `docker-modem`, cujo
 * `lib/modem.js` faz `require('./ssh')` na PRIMEIRA linha do módulo (transporte
 * SSH, que este runner nunca usa — ele fala com o socket unix local) → `ssh2` →
 * `lib/protocol/constants.js` → `require('cpu-features')` → um `.node` nativo.
 * O `require` do `cpu-features` é envolvido por `try/catch` lá dentro e degrada
 * em runtime, mas quem resolve o grafo aqui é o BUNDLER, em tempo de build, e
 * ele não tem `try/catch`. É a mesma classe de problema que o ADR 0112 já
 * documentou com `node-pty`, com a diferença que ali o binding é ESSENCIAL
 * (sem ele não há terminal) e aqui é aceleração opcional de um transporte que
 * não usamos.
 *
 * Medido e NÃO adotado, para o registro: `--external cpu-features` faz o
 * binário compilar (280 módulos contra 79, +1,7 MB) e o `dockerode` funcionar
 * de verdade contra o daemon lá dentro. É exatamente o "workaround criativo"
 * que a decisão do dono do produto excluiu de antemão — ele empurra um
 * `.node` opcional de uma árvore SSH morta para dentro de cinco binários por
 * plataforma, e a dívida ficaria ilegível para quem chegasse depois.
 *
 * ## O preço do CLI, dito por inteiro
 *
 * `execFile('docker', …)` não tem dependência nenhuma (`node:child_process`),
 * então some o risco de empacotamento inteiro — não há árvore de transporte a
 * embutir. Em troca:
 *
 *   - exige o BINÁRIO `docker` no `PATH`, e não só o socket. Na máquina de
 *     quem roda Docker isso é praticamente sempre verdade, e a ausência tem
 *     erro próprio (`DockerCliAusenteError`) em vez de virar "daemon fora";
 *   - a saída é TEXTO. Toda leitura aqui usa `--format '{{json .}}'` e
 *     `JSON.parse`, nunca corte de coluna — parsing posicional quebraria em
 *     silêncio na primeira mudança de layout do CLI;
 *   - a versão do CLI é a da máquina do usuário, não uma que o lockfile
 *     congela. Por isso nenhuma flag exótica é usada: `run`, `ps`, `stop`,
 *     `rm`, `inspect` e `exec` com opções que existem desde muito antes das
 *     versões que alguém possa ter.
 *
 * O broker do lado servidor (PR 1.2) NÃO herda esta decisão: ele roda numa
 * imagem que nós construímos e não vira binário standalone, então `dockerode`
 * segue candidato lá. É justamente por isso que a `DockerPort` existe — dois
 * implementadores, um contrato, nenhuma reescrita de quem chama.
 */

import { execFile } from 'node:child_process';
import {
  ContainerAusenteError,
  ContainerNaoGerenciadoError,
  DockerIndisponivelError,
  DockerPort,
  nomeDoContainer,
  PONTO_DE_MONTAGEM,
  ROTULO_GERENCIADO,
} from './docker-port.ts';
import type {
  ContainerIniciado,
  EspecificacaoDeContainer,
  EstadoDeContainer,
  EstadoObservadoDoContainer,
  PedidoDeExec,
  ResultadoDeExec,
} from './docker-port.ts';

/** Mesmos defaults de `exec.ts`: um comando no container e um comando na máquina têm o mesmo teto. */
export const TIMEOUT_DE_EXEC_PADRAO_MS = 15_000;
export const TETO_DE_BYTES_PADRAO = 32_768;

/** Teto das chamadas de CONTROLE (`ps`, `inspect`, `run`, `stop`, `rm`), que não são o comando do usuário. */
const TIMEOUT_DE_CONTROLE_MS = 30_000;

/** Segundos entre SIGTERM e SIGKILL num `docker stop`. */
const GRACA_DE_PARADA_S = 10;

export interface ResultadoDoCli {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Como o adaptador fala com o mundo. É o ÚNICO ponto de contato com o
 * processo externo, e existe separado por dois motivos: o teste substitui isto
 * (nenhum `docker` roda em `pnpm test`), e a superfície fica visível — quem
 * quiser saber tudo que este módulo pode fazer com a máquina lê as chamadas a
 * esta função, e não a biblioteca inteira de um vendor.
 */
export type RodarDocker = (args: readonly string[], timeoutMs: number) => Promise<ResultadoDoCli>;

export class DockerCliAusenteError extends Error {
  /** Origem no vocabulário do produto (`infra | modelo | código | política`). */
  readonly origem = 'infra';

  constructor() {
    super(
      'não encontrei o executável `docker` no PATH desta máquina. Instale o ' +
        'Docker (https://docs.docker.com/get-docker/) e confira com `docker version` ' +
        'antes de tentar de novo. Nenhum container foi tocado.',
    );
    this.name = 'DockerCliAusenteError';
  }
}

/**
 * O CLI recusou um comando, e NÃO sabemos por quê — imagem inexistente, disco
 * cheio, nome em uso, permissão de rede. A mensagem do daemon vai inteira, e
 * esta classe deliberadamente NÃO declara `origem`.
 *
 * Escolher uma origem aqui seria diagnóstico por eliminação, que é
 * exatamente o que o ADR 0020 registra como o defeito a não repetir. As duas
 * falhas que sabemos classificar têm classe própria (`DockerIndisponivelError`,
 * infra; `ContainerNaoGerenciadoError`, política); esta é o resto, e ela diz
 * que é o resto.
 */
export class ComandoDeDockerFalhouError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stderr: string;

  constructor(args: readonly string[], exitCode: number, stderr: string) {
    super(
      `\`docker ${args.join(' ')}\` terminou com código ${exitCode}: ` +
        `${stderr.trim() || '(sem saída de erro)'}`,
    );
    this.name = 'ComandoDeDockerFalhouError';
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Onde o CLI vai procurar o daemon — só para a mensagem de erro dizer a verdade. */
export function enderecoDoDaemon(env: NodeJS.ProcessEnv = process.env): string {
  return env.DOCKER_HOST ?? '/var/run/docker.sock';
}

/**
 * `execFile` sem shell — nunca `exec`: o comando do usuário viaja como UM
 * argumento de `docker exec … /bin/sh -c <comando>`, e passar por um shell
 * local no meio do caminho faria a máquina de quem roda o runner interpretar
 * o que era para o container interpretar.
 */
export const rodarDockerDeVerdade: RodarDocker = (args, timeoutMs) =>
  new Promise((resolvePromise, rejeitar) => {
    execFile(
      'docker',
      [...args],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (erro, stdout, stderr) => {
        if (erro === null) {
          resolvePromise({ exitCode: 0, stdout, stderr, timedOut: false });
          return;
        }
        const comErro = erro as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
        if (comErro.code === 'ENOENT') {
          rejeitar(new DockerCliAusenteError());
          return;
        }
        // `killed` + sinal = morto pelo `timeout` do próprio `execFile`.
        if (comErro.killed === true) {
          resolvePromise({ exitCode: -1, stdout, stderr, timedOut: true });
          return;
        }
        resolvePromise({
          exitCode: typeof comErro.code === 'number' ? comErro.code : 1,
          stdout,
          stderr,
          timedOut: false,
        });
      },
    );
  });

/**
 * O CLI não conseguiu falar com o daemon. Classificado pelo COMANDO, não por
 * substring da mensagem: `docker version` é o comando que só termina com 0
 * quando o cliente alcançou o servidor. Para os demais comandos, a mesma
 * pergunta é respondida por um `version` de confirmação — ver `executar`.
 */
const ARGS_DE_PING = ['version', '--format', '{{.Server.Version}}'];

const ESTADOS_CONHECIDOS: readonly EstadoDeContainer[] = [
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
];

/**
 * `State` do daemon → `EstadoDeContainer`. Valor desconhecido vira `dead` e não
 * uma exceção: uma leitura de estado nunca deve derrubar quem só queria saber
 * se o container está de pé, e `dead` é o único desfecho que não faz ninguém
 * agir como se estivesse funcionando.
 */
function estadoNormalizado(bruto: string): EstadoDeContainer {
  const candidato = bruto.toLowerCase() as EstadoDeContainer;
  return ESTADOS_CONHECIDOS.includes(candidato) ? candidato : 'dead';
}

interface LinhaDePs {
  ID?: string;
  Names?: string;
  State?: string;
}

interface InspecaoDeContainer {
  Id?: string;
  Name?: string;
  Config?: { Image?: string; Labels?: { [rotulo: string]: string } };
  Image?: string;
  State?: { Status?: string; StartedAt?: string };
}

export class DockerViaCli extends DockerPort {
  private readonly rodar: RodarDocker;
  private readonly endereco: string;

  constructor(rodar: RodarDocker = rodarDockerDeVerdade, endereco: string = enderecoDoDaemon()) {
    super();
    this.rodar = rodar;
    this.endereco = endereco;
  }

  /**
   * NÃO faz parte da `DockerPort`, e a ausência é deliberada: a porta tem cinco
   * operações sobre o container de UM projeto, e "o daemon está vivo?" não é
   * uma delas. Mora aqui, na classe concreta, porque tem consumidor concreto —
   * o `--self-test-docker` de `index.ts`, que é a prova de empacotamento do ADR
   * 0128 rodando contra o artefato publicável.
   *
   * Devolve `true` quando o daemon respondeu; lança quando não. Nunca devolve
   * `false`: "não sei" e "está fora" viraria o mesmo valor, e a RN-088 não
   * deixa colapsar estados assim.
   */
  async ping(): Promise<true> {
    const resultado = await this.rodar(ARGS_DE_PING, TIMEOUT_DE_CONTROLE_MS);
    if (resultado.exitCode !== 0) {
      throw new DockerIndisponivelError(this.endereco, this.causaDe(resultado));
    }
    return true;
  }

  async start(spec: EspecificacaoDeContainer): Promise<ContainerIniciado> {
    const nome = nomeDoContainer(spec.workspaceDirName);
    const existente = await this.resolver(nome);

    if (existente !== null) {
      if (existente.estado === 'running') {
        return { containerId: existente.id, nome, jaEstavaDePe: true };
      }
      // Container parado com o MESMO nome: sobe o que existe em vez de
      // recriar. Recriar perderia o que o container guardou fora do
      // bind-mount (cache de pacotes, por exemplo) sem ninguém ter pedido.
      await this.executar(['start', existente.id], TIMEOUT_DE_CONTROLE_MS);
      return { containerId: existente.id, nome, jaEstavaDePe: false };
    }

    const criado = await this.executar(this.argsDeCriacao(spec, nome), TIMEOUT_DE_CONTROLE_MS);
    return { containerId: criado.stdout.trim(), nome, jaEstavaDePe: false };
  }

  async stop(workspaceDirName: string): Promise<void> {
    const existente = await this.resolver(nomeDoContainer(workspaceDirName));
    // Ausente é no-op: parar o que já não está lá É o estado desejado, e um
    // erro aqui faria toda limpeza precisar de um `try` do lado de fora.
    if (existente === null || existente.estado !== 'running') return;
    await this.executar(
      ['stop', '--time', String(GRACA_DE_PARADA_S), existente.id],
      TIMEOUT_DE_CONTROLE_MS,
    );
  }

  async remove(workspaceDirName: string): Promise<void> {
    const existente = await this.resolver(nomeDoContainer(workspaceDirName));
    if (existente === null) return;
    // `--force` para o daemon parar antes de remover — evita a corrida entre
    // um `stop` nosso e um container que voltou a subir. O rótulo já foi
    // conferido em `resolver`, então o `--force` nunca alcança container de
    // terceiro.
    await this.executar(['rm', '--force', existente.id], TIMEOUT_DE_CONTROLE_MS);
  }

  async inspect(workspaceDirName: string): Promise<EstadoObservadoDoContainer | null> {
    const nome = nomeDoContainer(workspaceDirName);
    const existente = await this.resolver(nome);
    if (existente === null) return null;

    const saida = await this.executar(
      ['inspect', '--format', '{{json .}}', existente.id],
      TIMEOUT_DE_CONTROLE_MS,
    );
    const detalhe = primeiroJson<InspecaoDeContainer>(saida.stdout);
    if (detalhe === null) {
      // O container existia no `ps` e o `inspect` não devolveu JSON legível.
      // Ausência é a única resposta honesta — inventar estado a partir do que
      // o `ps` disse seria fundir observado com registrado (RN-468).
      return null;
    }

    const iniciadoEm = detalhe.State?.StartedAt;
    return {
      containerId: detalhe.Id ?? existente.id,
      nome,
      estado: estadoNormalizado(detalhe.State?.Status ?? ''),
      imagem: detalhe.Config?.Image ?? detalhe.Image ?? '',
      // O daemon devolve a data zero (`0001-01-01T00:00:00Z`) para container
      // que nunca subiu. Vira `null` aqui: uma data de ano 1 numa tela é pior
      // que a ausência declarada dela (RN-470).
      iniciadoEm:
        iniciadoEm === undefined || iniciadoEm === '' || iniciadoEm.startsWith('0001-01-01')
          ? null
          : iniciadoEm,
    };
  }

  async exec(workspaceDirName: string, pedido: PedidoDeExec): Promise<ResultadoDeExec> {
    const nome = nomeDoContainer(workspaceDirName);
    const existente = await this.resolver(nome);
    if (existente === null || existente.estado !== 'running') {
      throw new ContainerAusenteError(nome);
    }

    const timeoutMs = pedido.timeoutMs ?? TIMEOUT_DE_EXEC_PADRAO_MS;
    const maxBytes = pedido.maxBytes ?? TETO_DE_BYTES_PADRAO;
    const resultado = await this.rodar(
      [
        'exec',
        '--workdir',
        pedido.cwd ?? PONTO_DE_MONTAGEM,
        existente.id,
        // `sh -c` e o comando como UM argumento: o contrato do produto é um
        // comando de SHELL (pipe, redirecionamento, `&&`), o mesmo que
        // `exec.ts` executa na máquina. Quebrar em argv mudaria o significado
        // do que o usuário aprovou.
        '/bin/sh',
        '-c',
        pedido.comando,
      ],
      timeoutMs,
    );

    // stdout+stderr COMBINADOS e nesta ordem — a mesma saída de `exec.ts`, para
    // que "executou na máquina" e "executou no container" tenham a mesma forma
    // do outro lado (PR 1.6 escolhe entre os dois).
    const bruto = `${resultado.stdout}${resultado.stderr}`;
    const output = truncar(bruto, maxBytes);

    if (resultado.timedOut) {
      return { exitCode: -1, output: output + marcaDeTimeout(timeoutMs), timedOut: true };
    }
    return { exitCode: resultado.exitCode, output, timedOut: false };
  }

  /**
   * O ÚNICO caminho de resolução de container, e a razão de nenhuma operação
   * receber id: a busca é `docker ps` FILTRADO por nome + rótulo
   * `brabo.managed=true`, então um container homônimo sem o rótulo nunca é
   * devolvido para ser parado, removido ou usado como destino de `exec`.
   *
   * Quando existe o homônimo NÃO gerenciado, a resposta não é `null` — é
   * `ContainerNaoGerenciadoError`. A diferença importa: `null` faria `start`
   * tentar criar por cima e falhar com "name already in use", uma mensagem que
   * não diz nada sobre a única coisa que de fato aconteceu.
   */
  private async resolver(nome: string): Promise<{ id: string; estado: EstadoDeContainer } | null> {
    const gerenciados = await this.listar([
      `name=^/${nome}$`,
      `label=${ROTULO_GERENCIADO}=true`,
    ]);
    const gerenciado = gerenciados.find((linha) => nomesDaLinha(linha).includes(nome));
    if (gerenciado !== undefined) {
      return {
        id: gerenciado.ID ?? '',
        estado: estadoNormalizado(gerenciado.State ?? ''),
      };
    }

    const homonimos = await this.listar([`name=^/${nome}$`]);
    if (homonimos.some((linha) => nomesDaLinha(linha).includes(nome))) {
      throw new ContainerNaoGerenciadoError(nome);
    }
    return null;
  }

  private async listar(filtros: readonly string[]): Promise<LinhaDePs[]> {
    const args = ['ps', '--all', '--no-trunc', '--format', '{{json .}}'];
    for (const filtro of filtros) args.push('--filter', filtro);
    const saida = await this.executar(args, TIMEOUT_DE_CONTROLE_MS);
    // Uma linha de JSON por container — nunca um array. Linha vazia (nenhum
    // resultado) é o caso normal, não um erro.
    return saida.stdout
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha.length > 0)
      .flatMap((linha) => {
        const parsed = primeiroJson<LinhaDePs>(linha);
        return parsed === null ? [] : [parsed];
      });
  }

  /**
   * Toda chamada de CONTROLE passa por aqui — é o único ponto que decide entre
   * "o daemon não atendeu" (infra, nomeado) e "o daemon recusou este comando"
   * (motivo do daemon, repassado inteiro).
   *
   * A separação custa UM `docker version` a mais, e só no caminho de falha:
   * enquanto tudo dá certo, ninguém paga por ela. É o preço de não classificar
   * por substring de mensagem de vendor, que é o que o ADR 0002 e o ADR 0041 já
   * proíbem dos dois outros lados (git e LLM).
   */
  private async executar(
    args: readonly string[],
    timeoutMs: number,
  ): Promise<ResultadoDoCli> {
    const resultado = await this.rodar(args, timeoutMs);
    if (resultado.exitCode === 0) return resultado;

    const ping = await this.rodar(ARGS_DE_PING, TIMEOUT_DE_CONTROLE_MS);
    if (ping.exitCode !== 0) {
      throw new DockerIndisponivelError(this.endereco, this.causaDe(ping));
    }
    throw new ComandoDeDockerFalhouError(args, resultado.exitCode, resultado.stderr);
  }

  private causaDe(resultado: ResultadoDoCli): string {
    if (resultado.timedOut) return `o comando não respondeu no tempo limite`;
    return resultado.stderr.trim() || `\`docker version\` saiu com código ${resultado.exitCode}`;
  }

  /**
   * A tradução da spec FECHADA para os argumentos do `docker run`. É o único
   * lugar do repositório que escreve opção de `run`, e o que ele escreve é
   * DERIVADO — nenhum campo vindo de fora cai aqui sem passar pelo tipo.
   *
   * `--cap-drop ALL` é o que torna `cap_add` irrelevante, e não só
   * inexpressável; `--privileged` não aparece porque não há de onde copiá-lo.
   * Um leitor que procure "onde está o privileged deste produto" encontra esta
   * lista e a resposta.
   */
  private argsDeCriacao(spec: EspecificacaoDeContainer, nome: string): string[] {
    return [
      'run',
      '--detach',
      '--name',
      nome,
      '--label',
      `${ROTULO_GERENCIADO}=true`,
      '--label',
      `brabo.project.id=${spec.projectId}`,
      '--label',
      `brabo.project.slug=${spec.projectSlug}`,
      '--label',
      `brabo.workspace.id=${spec.workspaceId}`,
      '--label',
      `brabo.image.version=${spec.imagemVersao}`,
      // UM bind, destino constante, `rw` porque o dev agent escreve no código
      // do projeto — a mesma pasta que ele já escreveria fora do container.
      '--volume',
      `${spec.raizDoProjeto}:${PONTO_DE_MONTAGEM}:rw`,
      '--workdir',
      PONTO_DE_MONTAGEM,
      '--network',
      spec.rede === 'none' ? 'none' : 'bridge',
      '--cpus',
      String(spec.cpus),
      '--memory',
      `${spec.memoriaMb}m`,
      '--cap-drop',
      'ALL',
      spec.imagem,
      // Mantém o container vivo sem processo próprio: quem trabalha aqui são
      // os `exec`, e um container que sai assim que o `Cmd` termina não teria
      // onde recebê-los.
      'sleep',
      'infinity',
    ];
  }
}

/** `/brabo-x,/outro` → `['brabo-x', 'outro']` — o `Names` do `ps` é string, não lista. */
function nomesDaLinha(linha: LinhaDePs): string[] {
  return (linha.Names ?? '')
    .split(',')
    .map((nome) => nome.trim().replace(/^\//, ''))
    .filter((nome) => nome.length > 0);
}

/**
 * `JSON.parse` que devolve `null` em vez de lançar. Saída de CLI não é
 * contrato versionado: uma linha inesperada (aviso do daemon, mensagem de
 * atualização) não pode derrubar uma leitura.
 */
function primeiroJson<T>(texto: string): T | null {
  const limpo = texto.trim();
  if (limpo.length === 0) return null;
  try {
    return JSON.parse(limpo) as T;
  } catch {
    return null;
  }
}

function marcaDeTimeout(timeoutMs: number): string {
  return (
    `\n\n[runner: parei de esperar depois de ${timeoutMs}ms. O \`docker exec\` foi ` +
    `encerrado, mas o processo pode continuar rodando DENTRO do container — este ` +
    `timeout mata o cliente, não o comando.]`
  );
}

/**
 * Teto de bytes com marca clara, na mesma forma de `exec.ts` — inclusive na
 * contagem TOTAL: mentir o tamanho real esconderia justamente o dado que ajuda
 * a refinar o comando.
 */
function truncar(bruto: string, maxBytes: number): string {
  const buffer = Buffer.from(bruto, 'utf8');
  if (buffer.byteLength <= maxBytes) return bruto;
  const corpo = buffer.subarray(0, maxBytes).toString('utf8');
  return (
    corpo +
    `\n\n[saída truncada: ${maxBytes} de ${buffer.byteLength} bytes. ` +
    `Refine o comando (head, grep, -maxdepth) para ver o que falta.]`
  );
}

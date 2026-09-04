/**
 * A PORTA de acesso a Docker — cinco operações, e nada além delas.
 *
 * Mesma forma dos dois contratos que o repositório já usa para isolar um
 * fornecedor externo (`apps/api/src/application/ports/llm-provider.port.ts` e o
 * `GitProviderContract` da Fase 2): classe abstrata, tipos de entrada e saída
 * próprios do domínio, erros NORMALIZADOS por classe — quem consome decide pelo
 * tipo do erro, nunca por substring da mensagem do vendor.
 *
 * ## Por que a porta existe ANTES de qualquer container subir
 *
 * A frente de execução em container real tem DOIS implementadores previstos: o
 * runner (Docker da máquina do usuário) e um broker servidor (PR 1.2), e a
 * decisão de qual biblioteca usar de cada lado dependia de uma prova de
 * empacotamento que podia dar em qualquer direção — `dockerode` ou
 * `execFile('docker', …)`. Ela deu numa: `dockerode` REPROVOU no
 * `bun build --compile` do binário standalone, e o runner usa o CLI (o erro
 * exato está no docblock de `docker-cli.ts`, e o ADR 0128 tem a investigação
 * inteira). O broker não herda essa resposta — ele nunca vira binário —, e é
 * por isso que a porta existe: a segunda implementação é uma classe a mais
 * neste diretório, não uma reescrita de quem chama. É exatamente o que
 * `LLMProvider` compra em relação aos nove providers de LLM.
 *
 * ## A contenção é o TIPO, não a disciplina de quem chama
 *
 * O que este arquivo NÃO deixa escrever é a metade mais importante dele. Não há
 * como expressar, em nenhum parâmetro de nenhuma das cinco operações:
 *
 *   - `privileged` ou `cap_add` — não existe campo, e `HostConfig` do
 *     dockerode nunca atravessa a porta: a especificação é FECHADA e o
 *     adaptador é quem monta o payload do daemon;
 *   - `network: host` — `RedeDoContainer` é uma união de dois valores
 *     (`none` | `egress`), a mesma postura de fronteira do ADR 0065. `host`
 *     não é um valor do tipo, então não é uma frase que se possa dizer;
 *   - bind-mount livre — não há LISTA de mounts. Há UMA pasta
 *     (`raizDoProjeto`), o destino dela é constante (`PONTO_DE_MONTAGEM`), e o
 *     tipo dela é de marca (`RaizDeProjeto`): só `raizDeProjetoValidada` produz
 *     um valor desse tipo, e ela recusa caminho relativo, com `..`, com NUL, a
 *     raiz do filesystem e as pastas de sistema. Montar `/` ou
 *     `/var/run/docker.sock` não é "desaconselhado" aqui: não compila.
 *
 * Um conjunto estreito de operações é o que impede o consumidor de amanhã (o
 * broker, root-equivalente no host) de virar acesso arbitrário a Docker. Ele só
 * segura enquanto ninguém acrescentar a sexta operação "de passagem" —
 * `run`, `pull`, `build` ou qualquer coisa que receba spec pronta do chamador
 * são decisão de produto, com ADR, nunca um parâmetro a mais.
 *
 * ## Onde este arquivo MORA, e por que aqui
 *
 * `packages/docker-port/src/`, desde que o broker nasceu (ADR 0130). Ele
 * COMEÇOU em `apps/runner/src/` — o runner era o único consumidor — e o ADR
 * 0128 já escrevia que ele MOVERIA, não seria copiado, quando o segundo
 * consumidor aparecesse. O motivo está uma seção acima: um segundo arquivo com
 * as mesmas cinco operações e uma sexta "só no broker" é o começo do fim da
 * contenção.
 *
 * `packages/shared` foi considerado e recusado por um invariante que o próprio
 * pacote declara e um teste da api mantém honesto
 * (`packages-shared-so-tipos.spec.ts`): ele é 100% TIPO, nada ali pode
 * sobreviver ao `tsc` — e uma porta com classes de erro e uma função de
 * validação é código de runtime. Partir o contrato em "tipos lá, erros aqui"
 * criaria duas fontes para uma coisa só, que é o defeito que a porta existe
 * para evitar.
 *
 * O pacote novo NÃO tem passo de build, e isso é o que o mantém consumível: os
 * dois consumidores o EMPACOTAM (o runner por `tsup`/`bun build --compile`, o
 * broker por `tsup`), nenhum dos dois o resolve de `node_modules` em runtime
 * dentro de uma imagem. É por isso que a api não o consome — ela resolveria
 * (`pnpm deploy` copia o pacote de verdade, sem symlink) e morreria no boot com
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, o mesmo erro que o teste do
 * `packages/shared` existe para prevenir.
 */

import { resolve } from 'node:path';

/**
 * Onde a pasta do projeto aparece DENTRO do container. Constante, nunca
 * parâmetro: destino escolhível é a metade que transforma um bind-mount
 * contido num bind-mount livre (montar a pasta do projeto sobre `/etc` é tão
 * ruim quanto montar `/etc` na pasta do projeto).
 */
export const PONTO_DE_MONTAGEM = '/work';

/**
 * O rótulo que separa o que este produto pode parar e remover do que ele NUNCA
 * toca. Nenhuma operação de parada, remoção ou exec roda sem casar este rótulo
 * — é a diferença entre "limpar órfão" e "apagar o container de outra pessoa
 * que por acaso tinha nome parecido".
 */
export const ROTULO_GERENCIADO = 'brabo.managed';

/** Prefixo do nome do container gerenciado: `brabo-<workspace_dir_name>`. */
export const PREFIXO_DO_NOME = 'brabo-';

/**
 * A rede do container, como o ADR 0065 já decidiu para o produto: ou não há
 * rede, ou há saída para a internet. `host` — que daria ao container a pilha de
 * rede da máquina, incluindo `localhost` e os serviços do próprio Brabo — não é
 * um valor deste tipo, de propósito.
 */
export type RedeDoContainer = 'none' | 'egress';

declare const marcaDeRaizDeProjeto: unique symbol;

/**
 * Caminho de host que pode ser montado. Tipo de MARCA: um `string` comum não é
 * atribuível a ele, e o único jeito de obter um valor é
 * `raizDeProjetoValidada`. É isso que faz "bind-mount livre" deixar de ser
 * expressável — sem a marca, `raizDoProjeto: '/'` compilaria.
 */
export type RaizDeProjeto = string & { readonly [marcaDeRaizDeProjeto]: true };

export class RaizDeProjetoInvalidaError extends Error {
  /**
   * Origem no vocabulário do produto (`infra | modelo | código | política`):
   * `codigo`, porque um caminho recusado aqui é sempre defeito de quem
   * COMPÔS a chamada — o usuário nunca digita este valor.
   */
  readonly origem = 'codigo';
  // Propriedade explícita, não parameter property: `erasableSyntaxOnly`
  // recusa a forma curta (mesma razão registrada em `guard.ts`).
  readonly caminhoRecebido: string;
  readonly motivo: string;

  constructor(caminhoRecebido: string, motivo: string) {
    super(
      `caminho recusado como raiz de projeto para bind-mount: ` +
        `${JSON.stringify(caminhoRecebido)} — ${motivo}.`,
    );
    this.name = 'RaizDeProjetoInvalidaError';
    this.caminhoRecebido = caminhoRecebido;
    this.motivo = motivo;
  }
}

/**
 * Pastas cuja montagem dentro de um container entrega a máquina, mesmo sem
 * `privileged`: `/var` traz o socket do próprio Docker (que é root no host),
 * `/etc` traz `passwd`/`shadow`/`sudoers`, `/dev` traz os discos crus. A lista
 * é de PRIMEIRO segmento — montar `/etc/algo` é tão ruim quanto `/etc`.
 */
const PRIMEIROS_SEGMENTOS_DE_SISTEMA = [
  'bin',
  'boot',
  'dev',
  'etc',
  'lib',
  'lib32',
  'lib64',
  'proc',
  'root',
  'run',
  'sbin',
  'sys',
  'usr',
  'var',
];

/** `/a/b//` → `/a/b`, sem barra final. */
function semBarraFinal(caminho: string): string {
  const partes = caminho.split('/').filter((p) => p.length > 0);
  return `/${partes.join('/')}`;
}

/**
 * Valida LEXICAMENTE um caminho de host e devolve a marca — ou lança
 * `RaizDeProjetoInvalidaError`.
 *
 * ## Por que a validação é só léxica, e o que ela deliberadamente NÃO faz
 *
 * Não toca o disco: não confere existência, permissão nem symlink. Duas razões.
 * A primeira é que o outro implementador previsto (o broker, PR 1.2) valida um
 * caminho que existe na máquina do USUÁRIO e não na dele — um `existsSync` ali
 * responderia sobre o filesystem errado. A segunda é que a checagem que resolve
 * symlink já existe no runner, em `guard.ts`, e roda no lugar certo: no
 * `--dir` de startup, uma vez, com `realpath`. Duplicá-la aqui daria a
 * impressão de uma garantia forte onde há uma triagem.
 *
 * A regra do `$HOME` (RN-434, ADR 0104) TAMBÉM fica fora, e por escolha: ela é
 * do runner — no broker o caminho legítimo não está em `$HOME` nenhum. Quem
 * aplica as duas continua sendo `guard.ts`, no startup, sobre o mesmo caminho
 * que vira `raizDoProjeto`.
 *
 * O normalizador aqui é o mesmo `semBarraFinal` de `guard.ts`, escrito de novo
 * em vez de importado: este arquivo MOVE para um pacote quando o broker nascer
 * (ver o docblock do módulo), e arrastar a guarda de startup do runner junto
 * seria levar a peça errada.
 */
export function raizDeProjetoValidada(caminho: string): RaizDeProjeto {
  if (typeof caminho !== 'string' || caminho.length === 0) {
    throw new RaizDeProjetoInvalidaError(String(caminho), 'vazio ou não é string');
  }
  if (caminho.includes('\0')) {
    throw new RaizDeProjetoInvalidaError(caminho, 'contém byte NUL');
  }
  if (!caminho.startsWith('/')) {
    // Relativo dependeria do `cwd` de QUEM monta a spec, que não é a pasta do
    // projeto nem do lado do runner nem do lado do broker.
    throw new RaizDeProjetoInvalidaError(caminho, 'não é absoluto');
  }
  if (caminho.split('/').some((segmento) => segmento === '..')) {
    // Recusado ANTES de normalizar, de propósito: `resolve()` apagaria o `..`
    // e devolveria um caminho plausível, escondendo que a spec foi composta
    // com uma travessia dentro.
    throw new RaizDeProjetoInvalidaError(caminho, 'contém `..`');
  }

  const normalizado = semBarraFinal(resolve(caminho));

  if (normalizado === '/') {
    throw new RaizDeProjetoInvalidaError(caminho, 'é a raiz do filesystem');
  }

  const primeiroSegmento = normalizado.split('/')[1];
  if (primeiroSegmento !== undefined && PRIMEIROS_SEGMENTOS_DE_SISTEMA.includes(primeiroSegmento)) {
    throw new RaizDeProjetoInvalidaError(
      caminho,
      `está sob /${primeiroSegmento}, que é pasta de sistema`,
    );
  }

  return normalizado as RaizDeProjeto;
}

/**
 * O SEGMENTO relativo que se concatena a uma raiz de host para chegar à pasta
 * do projeto — a metade que a api manda pela rede (RN-501), e a única metade
 * que ela manda.
 *
 * Existe porque o broker passou a ter DUAS raízes (a gerenciada e a base dos
 * projetos montados, ADR 0141) e porque o segmento de um projeto montado é um
 * CAMINHO, com `/` no meio — `nomeDeWorkspaceValidado`, que serve ao nome do
 * container, recusa `/` de propósito e não serve aqui.
 *
 * Três recusas, e as três pelo mesmo motivo geométrico: o resultado da
 * concatenação tem de continuar DENTRO da raiz.
 *
 *   - `..` — recusado ANTES de qualquer normalização, como em
 *     `raizDeProjetoValidada`: `resolve()` apagaria o `..` e devolveria um
 *     caminho plausível fora da raiz, escondendo a travessia;
 *   - absoluto — `/etc` concatenado a uma raiz não é "sob a raiz" para
 *     ninguém que leia o resultado, e `resolve(raiz, '/etc')` é `/etc`;
 *   - vazio — `<raiz>/` é a PRÓPRIA raiz, isto é, montar a base inteira num
 *     container de um projeto só. Recusar aqui é a segunda barreira: a api já
 *     recusa (`segmentoSobABaseDeProjetos`), e este lado não pressupõe que ela
 *     esteja correta.
 *
 * NUL e barra dupla entram na mesma régua — o primeiro porque trunca caminho
 * em qualquer syscall, a segunda porque é o disfarce mais barato de um
 * segmento vazio no meio.
 */
export function segmentoDeProjetoValidado(segmento: unknown): string {
  if (typeof segmento !== 'string') {
    throw new RaizDeProjetoInvalidaError(
      String(segmento),
      'segmento de projeto não é string',
    );
  }
  if (segmento.length === 0) {
    throw new RaizDeProjetoInvalidaError(
      segmento,
      'segmento de projeto vazio — `<raiz>/` é a própria raiz, e montar a ' +
        'raiz inteira daria a este container a pasta de todos os projetos',
    );
  }
  if (segmento.includes('\0')) {
    throw new RaizDeProjetoInvalidaError(segmento, 'contém byte NUL');
  }
  if (segmento.startsWith('/')) {
    throw new RaizDeProjetoInvalidaError(
      segmento,
      'é absoluto — o segmento é o pedaço RELATIVO que a raiz do broker não ' +
        'cobre, e concatenar um absoluto simplesmente descarta a raiz',
    );
  }
  const partes = segmento.split('/');
  if (partes.some((p) => p === '..')) {
    throw new RaizDeProjetoInvalidaError(segmento, 'contém `..`');
  }
  if (partes.some((p) => p.length === 0)) {
    throw new RaizDeProjetoInvalidaError(
      segmento,
      'tem segmento vazio (barra dupla ou barra final)',
    );
  }
  return segmento;
}

/**
 * A especificação COMPLETA de um container gerenciado. É fechada de propósito:
 * o que não está aqui não pode ser pedido ao daemon, porque o adaptador monta o
 * payload a partir deste tipo e de mais nada.
 *
 * Nenhum campo aqui é "spec de Docker" — são os dados do PROJETO, e a tradução
 * para `HostConfig`/`NetworkingConfig` acontece do lado de dentro. Um chamador
 * que queira `privileged` não tem onde escrever isso.
 */
export interface EspecificacaoDeContainer {
  /**
   * `workspace_dir_name` (RN-109): `<slug>-<8 do id>`, congelado na criação e
   * único mesmo entre workspaces diferentes. É a fonte ÚNICA do nome do
   * container (`brabo-<workspace_dir_name>`) — derivar um segundo nome seria
   * criar uma segunda verdade sobre a mesma coisa.
   */
  readonly workspaceDirName: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly workspaceId: string;
  /**
   * A imagem que o ARQUITETO decidiu (`artifact.project_image`), com tag ou
   * digest explícito. A política de imagem — `latest` recusado, etc. — é
   * validada por quem COMPÕE a spec (`validarDecisaoDeImagem`, do lado da api),
   * nunca aqui: repetir a regra num segundo lugar produziria duas versões dela.
   */
  readonly imagem: string;
  /** Versão do artefato de imagem, gravada no rótulo `brabo.image.version`. */
  readonly imagemVersao: string;
  readonly rede: RedeDoContainer;
  /** A ÚNICA pasta montada, sempre em `PONTO_DE_MONTAGEM`. */
  readonly raizDoProjeto: RaizDeProjeto;
  readonly cpus: number;
  readonly memoriaMb: number;
  /**
   * Teto de processos (`--pids-limit`) — o que contém fork bomb sem depender de
   * allowlist de comando, e o terceiro número que a decisão do Arquiteto já
   * declara (`RecursosDoContainer.pidsLimit`, do lado da api).
   *
   * Entrou no ADR 0130, quando o broker passou a LER aquele artefato: sem o
   * campo, o artefato prometia um teto de processos que o container não
   * recebia — exatamente o "artefato que promete mais do que o container
   * recebe mente para quem o audita" que o domínio da api já nomeia. É um
   * campo de CONTENÇÃO, não de flexibilidade; a régua de "não acrescente
   * parâmetro" vale para o que AFROUXA.
   */
  readonly pidsLimit: number;
}

export interface ContainerIniciado {
  readonly containerId: string;
  readonly nome: string;
  /**
   * `true` quando o container já existia e já estava de pé — `start` é
   * IDEMPOTENTE. Quem chama precisa saber a diferença para não narrar "subi o
   * container" quando não subiu nada.
   */
  readonly jaEstavaDePe: boolean;
}

/**
 * Os estados que o daemon reporta, sem tradução nem colapso. É o estado
 * OBSERVADO — a tabela `project_containers` guarda o REGISTRADO, e os dois
 * nunca são fundidos numa coluna só (RN-468: proxy não vira garantia).
 */
export type EstadoDeContainer =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead';

export interface EstadoObservadoDoContainer {
  readonly containerId: string;
  readonly nome: string;
  readonly estado: EstadoDeContainer;
  readonly imagem: string;
  /** ISO-8601 como o daemon devolve, ou `null` quando ele nunca subiu. */
  readonly iniciadoEm: string | null;
}

export interface PedidoDeExec {
  readonly comando: string;
  /**
   * Diretório de trabalho DENTRO do container. Ausente = `PONTO_DE_MONTAGEM`.
   * Quem manda um `cwd` continua devendo a validação de escopo do lado de fora
   * (`guard.ts` no runner) — o container não é fronteira de caminho por si só.
   */
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

/**
 * Mesma forma de `ExecResult` (`exec.ts`), e isso é intencional: o consumidor
 * de amanhã (PR 1.6) escolhe entre executar na máquina e executar no container,
 * e um resultado com forma diferente forçaria dois caminhos de tratamento para
 * a mesma decisão. `exitCode: -1` é o mesmo sentinela de "morto sem código".
 */
export interface ResultadoDeExec {
  readonly exitCode: number;
  readonly output: string;
  readonly timedOut: boolean;
}

/**
 * O daemon não respondeu. Origem `infra` no vocabulário do produto — nunca
 * diagnóstico por eliminação (lição do ADR 0020): esta classe é lançada só
 * quando o erro do transporte diz que ninguém atendeu, e a mensagem diz o que
 * FAZER, porque quem a lê é a pessoa na frente da própria máquina.
 */
export class DockerIndisponivelError extends Error {
  readonly origem = 'infra';
  readonly endereco: string;
  readonly causa: string;

  constructor(endereco: string, causa: string) {
    super(
      `não consegui falar com o Docker em ${endereco}: ${causa}. ` +
        `Verifique se o Docker está rodando (\`docker info\`) e se o seu usuário ` +
        `alcança o socket — no Linux isso costuma ser o grupo \`docker\`. ` +
        `Nenhum container foi tocado.`,
    );
    this.name = 'DockerIndisponivelError';
    this.endereco = endereco;
    this.causa = causa;
  }
}

/**
 * Existe um container com o nome derivado, mas ele NÃO tem o rótulo
 * `brabo.managed=true`. Origem `politica`: não é falha de infra nem defeito de
 * código, é a recusa que separa o que este produto governa do que ele não
 * governa. Recusar é o comportamento CORRETO — parar um container homônimo de
 * outra pessoa seria o defeito.
 */
export class ContainerNaoGerenciadoError extends Error {
  readonly origem = 'politica';
  readonly nome: string;

  constructor(nome: string) {
    super(
      `o container ${nome} existe mas não tem o rótulo ${ROTULO_GERENCIADO}=true — ` +
        `ele não foi criado pelo Brabo e não será tocado. Renomeie ou remova o ` +
        `container homônimo você mesmo, se ele for seu.`,
    );
    this.name = 'ContainerNaoGerenciadoError';
    this.nome = nome;
  }
}

/**
 * Nenhum container gerenciado com esse nome. `inspect` devolve `null` neste
 * caso (ausência é resposta legítima de uma leitura); `exec` LANÇA, porque não
 * há onde executar.
 */
export class ContainerAusenteError extends Error {
  readonly origem = 'politica';
  readonly nome: string;

  constructor(nome: string) {
    super(`não há container gerenciado chamado ${nome} — suba o container antes.`);
    this.name = 'ContainerAusenteError';
    this.nome = nome;
  }
}

/**
 * As CINCO operações. Não seis.
 *
 * Nenhuma delas recebe id de container: todas partem do `workspaceDirName` e
 * derivam o nome, e o adaptador confirma o rótulo `brabo.managed=true` antes de
 * agir. "Pare o container X", com X arbitrário, não é uma frase que esta porta
 * saiba ouvir.
 */
export abstract class DockerPort {
  /**
   * Sobe o container do projeto. IDEMPOTENTE: chamada em cima de um container
   * já de pé devolve `jaEstavaDePe: true` sem recriar nada — é o que permite ao
   * chamador tratar restart e primeira subida com o mesmo caminho.
   */
  abstract start(spec: EspecificacaoDeContainer): Promise<ContainerIniciado>;

  /** Para o container do projeto. Container ausente é no-op, não erro. */
  abstract stop(workspaceDirName: string): Promise<void>;

  /** Remove o container do projeto (parando antes, se preciso). Ausente é no-op. */
  abstract remove(workspaceDirName: string): Promise<void>;

  /**
   * O estado OBSERVADO, ou `null` quando não há container. Nunca inventa
   * estado a partir do que foi registrado — é justamente a diferença entre as
   * duas colunas que a tela de containers (PR 1.8) vai mostrar separadas.
   */
  abstract inspect(workspaceDirName: string): Promise<EstadoObservadoDoContainer | null>;

  /**
   * Um comando dentro do container em execução. `exec`, nunca `attach`: cada
   * chamada é independente e não deixa handle de longa duração, que é o que
   * torna um restart do engine sobrevivível sem tabela de estado nova.
   */
  abstract exec(workspaceDirName: string, pedido: PedidoDeExec): Promise<ResultadoDeExec>;
}

/** `brabo-<workspace_dir_name>` — a única derivação do nome (ver RN-109). */
export function nomeDoContainer(workspaceDirName: string): string {
  return `${PREFIXO_DO_NOME}${workspaceDirName}`;
}

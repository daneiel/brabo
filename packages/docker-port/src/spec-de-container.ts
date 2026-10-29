/**
 * A COMPOSIÇÃO da especificação de container — a única fábrica de
 * `EspecificacaoDeContainer` que existe fora de um literal escrito à mão.
 *
 * ## Por que isto não é "mais uma validação de imagem"
 *
 * A api já valida a decisão do Arquiteto quando ela é ESCRITA
 * (`validarDecisaoDeImagem`, `apps/api/src/domain/containers/project-container.ts`):
 * exige `rationale`, recusa `latest`, aplica os tetos de `RECURSOS_MAXIMOS` e
 * devolve a recusa ao MODELO pelo tool-result (RN-061). Aquela função responde
 * "esta decisão de arquitetura é revisável?".
 *
 * Esta responde outra pergunta, no outro lado do arame: "posso entregar isto ao
 * daemon?". Os dois consumidores da porta (o runner, na máquina do usuário; o
 * broker, no servidor) recebem a decisão por HTTP, de um serviço que eles não
 * controlam e cuja correção eles NÃO podem pressupor — o broker é
 * root-equivalente no host, e um broker que confia no chamador não contém nada.
 * Por isso ele faz o PARSE do JSON que recebeu para dentro do tipo fechado, em
 * vez de fazer um cast.
 *
 * A sobreposição entre as duas é pequena e declarada: referência com tag ou
 * digest, e um teto numérico. O que ela NÃO é: um espelho que precise ser
 * mantido em sincronia. Os tetos daqui são os do BROKER — o último recurso, o
 * que ele nunca ultrapassa qualquer que seja o artefato —, e os da api são os
 * do ARTEFATO. Hoje os números são iguais de propósito; se um dia divergirem,
 * o menor vence e nada quebra, porque nenhum dos dois afirma ser o outro.
 *
 * ## O que só existe deste lado
 *
 * Uma coisa que a api não tem por que checar e este lado não pode deixar
 * passar: **argumento que começa com `-`**. `image` vira um argumento posicional
 * de `docker run`, e uma referência como `--privileged` seria lida pelo CLI como
 * FLAG, não como imagem. `execFile` sem shell resolve injeção de comando, não
 * injeção de ARGUMENTO — são coisas diferentes, e a segunda se resolve aqui.
 */

import { isIP } from 'node:net';
import {
  idDeUsuarioValido,
  type HostExtra,
  type InstanciaDeQa,
  type PortaDoContainer,
  type ServicoDeQa,
  raizDeProjetoValidada,
  type UsuarioDoContainer,
  type EspecificacaoDeContainer,
} from './docker-port.ts';

/**
 * O teto do BROKER/RUNNER, não o do artefato. Ver o docblock do módulo: a api
 * tem o dela (`RECURSOS_MAXIMOS`), com outro propósito. Hoje os números
 * coincidem; a coincidência não é um contrato.
 */
export const TETO_DE_RECURSOS = {
  cpus: 8,
  memoriaMb: 16_384,
  pidsLimit: 4096,
} as const;

/**
 * `workspace_dir_name` (RN-109) vira NOME de container e vira parte de um
 * caminho de host. As duas coisas exigem a mesma largura estreita que
 * `SEGMENTO_DE_URL_INTERNA_VALIDO` já usa na api e que
 * `NOME_DE_PASTA_VALIDO` usa em `project-workspaces-root.ts`: sem `/`, sem
 * `..`, sem espaço, sem NUL.
 */
const NOME_DE_WORKSPACE_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * O que o daemon recusaria de qualquer forma, mais o que ele NÃO recusaria e
 * deveria: espaço em branco e metacaractere de shell (a referência viaja como
 * argumento; um shell no meio do caminho seria defeito de quem chama, mas
 * recusar é mais barato que confiar).
 */
const METACARACTERES = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  '\0',
  ';',
  '&',
  '|',
  '$',
  '`',
  '(',
  ')',
  '<',
  '>',
  '"',
  "'",
  '\\',
  '*',
  '?',
  '!',
  '#',
]);

/**
 * A especificação recebida não vira container. Origem `politica` no vocabulário
 * do produto (`infra | modelo | codigo | politica`): não é o daemon fora do ar
 * nem defeito de quem compôs a chamada — é a recusa deliberada de executar o
 * que foi pedido, e ela é o comportamento CORRETO.
 */
export class EspecificacaoInvalidaError extends Error {
  readonly origem = 'politica';
  readonly campo: string;
  readonly motivo: string;

  constructor(campo: string, motivo: string) {
    super(`especificação de container recusada em \`${campo}\`: ${motivo}.`);
    this.name = 'EspecificacaoInvalidaError';
    this.campo = campo;
    this.motivo = motivo;
  }
}

/**
 * O que chega pela rede: tudo `unknown`, porque tudo é JSON de outro processo.
 * O tipo existe para NOMEAR os campos, nunca para afirmar o que eles são —
 * quem afirma é `especificacaoValidada`.
 */
export interface EntradaDeEspecificacao {
  workspaceDirName?: unknown;
  projectId?: unknown;
  projectSlug?: unknown;
  workspaceId?: unknown;
  imagem?: unknown;
  imagemVersao?: unknown;
  rede?: unknown;
  cpus?: unknown;
  memoriaMb?: unknown;
  pidsLimit?: unknown;
  /** Caminho de HOST da pasta do projeto — a única coisa montada no container. */
  raizDoProjeto?: unknown;
  /** `{uid, gid}` medido pela api, ou `null`/ausente. Ver `usuarioValidado`. */
  usuario?: unknown;
  /** AT-610: comando do app (≤300, sem `\n \r \0`). */
  comandoDoApp?: unknown;
  /** AT-608: `[{host, container, protocolo}]`. */
  portas?: unknown;
  dns?: unknown;
  hostsExtras?: unknown;
  /** AT-612: `{chave, servicos}` — instância de QA. */
  qa?: unknown;
}

/** As portas da instalação: publicar uma delas no loopback colidiria com o próprio Brabo. */
export const PORTAS_DA_INSTALACAO: readonly number[] = [
  3000, 4000, 5173, 5432, 7474, 7687, 8088, 8090, 11434,
];
export const TETO_DE_PORTAS = 10;
export const TETO_DE_DNS = 3;
export const TETO_DE_HOSTS_EXTRAS = 10;
export const TETO_DO_COMANDO_DO_APP = 300;
export const TETO_DE_SERVICOS_DE_QA = 6;
/** Nomes que `--add-host` nunca pode sobrescrever: o loopback e os serviços do Brabo. */
export const NOMES_RESERVADOS = [
  'localhost',
  'host.docker.internal',
  'api',
  'engine',
  'web',
  'postgres',
  'neo4j',
  'broker',
  'ollama',
];
/** Teto CONSTANTE de cada serviço de QA, qualquer que seja o pedido. */
export const TETO_DE_SERVICO_DE_QA = { cpus: 1, memoriaMb: 512, pidsLimit: 256 } as const;

const CHAVE_DE_QA = /^[a-z0-9]{8}$/;
const NOME_DE_SERVICO = /^[a-z][a-z0-9-]{0,31}$/;
const CHAVE_DE_ENV = /^[A-Z_][A-Z0-9_]*$/;
const DIGEST = /@sha256:[a-f0-9]{64}$/;
const CAMINHO_DE_DADOS = /^\/[A-Za-z0-9_./-]+$/;

/**
 * O PARSE do usuário (ADR 0180). Ausente e `null` são "como sempre"; qualquer
 * outra coisa tem de ser `{uid, gid}` de inteiros em 1..2^31-1 — `0` é recusado
 * (root é o ausente, e um `--user 0` explícito seria um afrouxamento que
 * ninguém decidiu) e nada é corrigido em silêncio.
 */
export function usuarioValidado(valor: unknown): UsuarioDoContainer | null {
  if (valor === undefined || valor === null) return null;
  const u = valor as { uid?: unknown; gid?: unknown };
  if (typeof valor !== 'object' || !idDeUsuarioValido(u.uid)) {
    throw new EspecificacaoInvalidaError(
      'usuario.uid',
      `esperava inteiro de 1 a 2147483647, recebi ${descrever((u ?? {}).uid)}`,
    );
  }
  if (!idDeUsuarioValido(u.gid)) {
    throw new EspecificacaoInvalidaError(
      'usuario.gid',
      `esperava inteiro de 1 a 2147483647, recebi ${descrever(u.gid)}`,
    );
  }
  return { uid: u.uid, gid: u.gid };
}

/**
 * O `workspace_dir_name`, validado — exportado à parte porque QUATRO das cinco
 * operações da porta precisam só dele (elas derivam o nome do container e não
 * tocam em imagem nenhuma). Sem esta função, quem chama `stop` teria de repetir
 * a expressão regular, e o mais provável é que a repetisse um pouco diferente.
 */
export function nomeDeWorkspaceValidado(valor: unknown): string {
  const nome = texto(valor, 'workspaceDirName');
  if (!NOME_DE_WORKSPACE_VALIDO.test(nome)) {
    throw new EspecificacaoInvalidaError(
      'workspaceDirName',
      'só aceito letras, dígitos, `-` e `_`, de 1 a 64 caracteres — ele vira ' +
        'nome de container e segmento de caminho',
    );
  }
  return nome;
}

/**
 * Referência OCI que pode virar argumento de `docker run`.
 *
 * Não reimplementa a gramática do distribution spec (a api também não): recusa
 * o que a faria deixar de ser uma referência, mais as duas coisas que só
 * importam deste lado — começar com `-` e não ter versão.
 */
export function referenciaDeImagemAceitavel(ref: string): boolean {
  if (ref.length === 0 || ref.length > 512) return false;
  // Argumento que começa com `-` é FLAG para o CLI. Ver o docblock do módulo.
  if (ref.startsWith('-')) return false;
  for (const c of ref) if (METACARACTERES.has(c)) return false;
  return temTagOuDigest(ref);
}

/**
 * A tag vem depois do ÚLTIMO `:`, e só é tag se não houver `/` depois —
 * `registry.local:5000/app` tem dois-pontos de PORTA. Mesma leitura que a api
 * faz do outro lado, pela mesma razão: tratar a porta como tag deixaria passar
 * uma referência sem versão nenhuma.
 */
function temTagOuDigest(ref: string): boolean {
  const digest = ref.indexOf('@sha256:');
  if (digest > 0) return ref.length > digest + '@sha256:'.length;

  const doisPontos = ref.lastIndexOf(':');
  if (doisPontos <= 0) return false;
  const depois = ref.slice(doisPontos + 1);
  if (depois.length === 0 || depois.includes('/')) return false;

  // `latest` é o mesmo que não ter tag: o container que subiu em março e o que
  // sobe hoje são imagens diferentes com o mesmo nome, e a auditoria mente.
  return depois !== 'latest';
}

/**
 * O PARSE — de JSON de outro processo para o tipo fechado que a porta aceita.
 *
 * Lança `EspecificacaoInvalidaError` nomeando o campo. Nunca corrige em
 * silêncio: rebaixar `cpus: 999` para 8 faria o container ser uma coisa e o
 * registro dizer outra, que é o defeito que a versão auditável do artefato
 * existe para não ter.
 */
export function especificacaoValidada(
  entrada: EntradaDeEspecificacao,
): EspecificacaoDeContainer {
  const workspaceDirName = nomeDeWorkspaceValidado(entrada.workspaceDirName);

  const imagem = texto(entrada.imagem, 'imagem');
  if (!referenciaDeImagemAceitavel(imagem)) {
    throw new EspecificacaoInvalidaError(
      'imagem',
      `${JSON.stringify(imagem)} não é uma referência OCI que eu entregue ao ` +
        'daemon: use tag explícita ou digest (`node:22-bookworm-slim`, ' +
        '`app@sha256:…`), sem `latest`, sem espaço, sem metacaractere e sem ' +
        'começar com `-`',
    );
  }

  const rede = entrada.rede;
  if (rede !== 'none' && rede !== 'egress') {
    throw new EspecificacaoInvalidaError(
      'rede',
      `"${descrever(rede)}" não é uma postura de rede. Só existem duas ` +
        '(`none`, `egress`), e `host` não é uma delas em lugar nenhum deste ' +
        'produto (ADR 0065)',
    );
  }

  const usuario = usuarioValidado(entrada.usuario);
  const comandoDoApp = comandoDoAppValidado(entrada.comandoDoApp);
  const portas = portasValidadas(entrada.portas);
  const dns = dnsValidado(entrada.dns);
  const hostsExtras = hostsExtrasValidados(entrada.hostsExtras);
  const qa = instanciaDeQaValidada(entrada.qa);

  if (rede === 'none' && (portas.length > 0 || dns.length > 0 || hostsExtras.length > 0)) {
    throw new EspecificacaoInvalidaError(
      'rede',
      'portas, dns e hostsExtras exigem rede `egress`: com `none` o container não tem pilha de rede',
    );
  }
  if (qa !== null) {
    if (comandoDoApp !== null || portas.length > 0) {
      throw new EspecificacaoInvalidaError(
        'qa',
        'a instância de QA não sobe app e não publica porta: o app de trabalho nunca é tocado',
      );
    }
    if (rede === 'none' && qa.servicos.some((x) => x.compartilhado === true)) {
      throw new EspecificacaoInvalidaError(
        'qa.servicos',
        'serviço compartilhado exige rede `egress`: a instância se liga à rede privada do projeto',
      );
    }
  }

  return {
    workspaceDirName,
    projectId: texto(entrada.projectId, 'projectId'),
    projectSlug: texto(entrada.projectSlug, 'projectSlug'),
    workspaceId: texto(entrada.workspaceId, 'workspaceId'),
    imagem,
    imagemVersao: texto(entrada.imagemVersao, 'imagemVersao'),
    rede,
    raizDoProjeto: raizDeProjetoValidada(
      texto(entrada.raizDoProjeto, 'raizDoProjeto'),
    ),
    cpus: numeroNoTeto(entrada.cpus, 'cpus', TETO_DE_RECURSOS.cpus),
    memoriaMb: numeroNoTeto(
      entrada.memoriaMb,
      'memoriaMb',
      TETO_DE_RECURSOS.memoriaMb,
    ),
    pidsLimit: numeroNoTeto(
      entrada.pidsLimit,
      'pidsLimit',
      TETO_DE_RECURSOS.pidsLimit,
    ),
    // Só aparece quando há: a spec do runner (ADR 0137) não tem dono medido.
    ...(usuario === null ? {} : { usuario }),
    // Só aparecem quando há: ausentes, a spec é byte a byte a de antes.
    ...(comandoDoApp === null ? {} : { comandoDoApp }),
    ...(portas.length === 0 ? {} : { portas }),
    ...(dns.length === 0 ? {} : { dns }),
    ...(hostsExtras.length === 0 ? {} : { hostsExtras }),
    ...(qa === null ? {} : { qa }),
  };
}

/** AT-610: ≤300, uma linha, sem NUL. Vazio é recusado (ausente/`null` é o jeito de dizer "sem app"). */
export function comandoDoAppValidado(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new EspecificacaoInvalidaError('comandoDoApp', `esperava texto não vazio, recebi ${descrever(valor)}`);
  }
  if (valor.length > TETO_DO_COMANDO_DO_APP) {
    throw new EspecificacaoInvalidaError('comandoDoApp', `passa de ${TETO_DO_COMANDO_DO_APP} caracteres`);
  }
  if (temQuebraOuNul(valor)) {
    throw new EspecificacaoInvalidaError('comandoDoApp', 'contém quebra de linha ou NUL');
  }
  return valor;
}

function listaOuVazia(valor: unknown, campo: string, teto: number): unknown[] {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) {
    throw new EspecificacaoInvalidaError(campo, `esperava lista, recebi ${descrever(valor)}`);
  }
  if (valor.length > teto) {
    throw new EspecificacaoInvalidaError(campo, `${valor.length} itens passam do teto de ${teto}`);
  }
  return valor;
}

function portaNaFaixa(n: unknown, campo: string, minimo: number): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < minimo || n > 65535) {
    throw new EspecificacaoInvalidaError(campo, `esperava inteiro de ${minimo} a 65535, recebi ${descrever(n)}`);
  }
  return n;
}

/** AT-608: sempre TCP, host 1024–65535 fora da instalação, sem duplicata. O IP (127.0.0.1) é constante do adaptador. */
export function portasValidadas(valor: unknown): PortaDoContainer[] {
  const vistos = new Set<number>();
  return listaOuVazia(valor, 'portas', TETO_DE_PORTAS).map((item, i) => {
    const p = (item ?? {}) as { host?: unknown; container?: unknown; protocolo?: unknown };
    const host = portaNaFaixa(p.host, `portas[${i}].host`, 1024);
    const container = portaNaFaixa(p.container, `portas[${i}].container`, 1);
    if (p.protocolo !== 'tcp') {
      throw new EspecificacaoInvalidaError(`portas[${i}].protocolo`, `só existe \`tcp\`, recebi ${descrever(p.protocolo)}`);
    }
    if (PORTAS_DA_INSTALACAO.includes(host)) {
      throw new EspecificacaoInvalidaError(`portas[${i}].host`, `${host} é porta da instalação do Brabo`);
    }
    if (vistos.has(host)) {
      throw new EspecificacaoInvalidaError(`portas[${i}].host`, `${host} aparece duas vezes`);
    }
    vistos.add(host);
    return { host, container, protocolo: 'tcp' as const };
  });
}

/** AT-608: IP literal v4/v6, teto 3. */
export function dnsValidado(valor: unknown): string[] {
  return listaOuVazia(valor, 'dns', TETO_DE_DNS).map((ip, i) => {
    if (typeof ip !== 'string' || isIP(ip) === 0) {
      throw new EspecificacaoInvalidaError(`dns[${i}]`, `esperava IP literal, recebi ${descrever(ip)}`);
    }
    return ip;
  });
}

/** AT-608: nome em `[a-z0-9.-]` (≤253), nunca reservado; IPv4 literal (v6 em `--add-host` é ambíguo com o `:`). */
export function hostsExtrasValidados(valor: unknown): HostExtra[] {
  return listaOuVazia(valor, 'hostsExtras', TETO_DE_HOSTS_EXTRAS).map((item, i) => {
    const h = (item ?? {}) as { nome?: unknown; ip?: unknown };
    const nome = h.nome;
    if (
      typeof nome !== 'string' ||
      nome.length === 0 ||
      nome.length > 253 ||
      !/^[a-z0-9.-]+$/.test(nome) ||
      /^[.-]|[.-]$|\.\./.test(nome)
    ) {
      throw new EspecificacaoInvalidaError(`hostsExtras[${i}].nome`, `nome inválido: ${descrever(nome)}`);
    }
    if (NOMES_RESERVADOS.includes(nome) || nome.startsWith('brabo')) {
      throw new EspecificacaoInvalidaError(`hostsExtras[${i}].nome`, `${nome} é reservado (loopback ou serviço da instalação)`);
    }
    if (typeof h.ip !== 'string' || isIP(h.ip) !== 4) {
      throw new EspecificacaoInvalidaError(`hostsExtras[${i}].ip`, `esperava IPv4 literal, recebi ${descrever(h.ip)}`);
    }
    return { nome, ip: h.ip };
  });
}

/** AT-612: chave `[a-z0-9]{8}` e serviços declarados pela Infra, imagem por digest. */
export function instanciaDeQaValidada(valor: unknown): InstanciaDeQa | null {
  if (valor === undefined || valor === null) return null;
  const q = valor as { chave?: unknown; servicos?: unknown };
  if (typeof q.chave !== 'string' || !CHAVE_DE_QA.test(q.chave)) {
    throw new EspecificacaoInvalidaError('qa.chave', `esperava 8 caracteres [a-z0-9], recebi ${descrever(q.chave)}`);
  }
  const nomes = new Set<string>();
  const servicos = listaOuVazia(q.servicos, 'qa.servicos', TETO_DE_SERVICOS_DE_QA).map((item, i) =>
    servicoDeQaValidado(item, i, nomes),
  );
  return { chave: q.chave, servicos };
}

function servicoDeQaValidado(item: unknown, i: number, nomes: Set<string>): ServicoDeQa {
  const campo = `qa.servicos[${i}]`;
  const s = (item ?? {}) as Record<string, unknown>;
  if (typeof s.nome !== 'string' || !NOME_DE_SERVICO.test(s.nome) || nomes.has(s.nome)) {
    throw new EspecificacaoInvalidaError(`${campo}.nome`, `nome inválido ou repetido: ${descrever(s.nome)}`);
  }
  nomes.add(s.nome);
  if (typeof s.imagem !== 'string' || !referenciaDeImagemAceitavel(s.imagem) || !DIGEST.test(s.imagem)) {
    throw new EspecificacaoInvalidaError(`${campo}.imagem`, 'exige referência por digest (`nome@sha256:<64 hex>`), sem tag solta');
  }
  const env: Record<string, string> = {};
  if (s.env !== undefined && s.env !== null) {
    if (typeof s.env !== 'object' || Array.isArray(s.env) || Object.keys(s.env).length > 20) {
      throw new EspecificacaoInvalidaError(`${campo}.env`, 'esperava objeto com até 20 chaves');
    }
    for (const [k, v] of Object.entries(s.env)) {
      if (!CHAVE_DE_ENV.test(k) || typeof v !== 'string' || v.length > 1024 || temQuebraOuNul(v)) {
        throw new EspecificacaoInvalidaError(`${campo}.env`, `variável ${JSON.stringify(k)} inválida`);
      }
      env[k] = v;
    }
  }
  const dados = listaOuVazia(s.dados, `${campo}.dados`, 3).map((c) => {
    if (typeof c !== 'string' || !CAMINHO_DE_DADOS.test(c) || c.split('/').includes('..')) {
      throw new EspecificacaoInvalidaError(`${campo}.dados`, `caminho de tmpfs inválido: ${descrever(c)}`);
    }
    return c;
  });
  if (s.compartilhado !== undefined && typeof s.compartilhado !== 'boolean') {
    throw new EspecificacaoInvalidaError(`${campo}.compartilhado`, 'esperava booleano');
  }
  return {
    nome: s.nome,
    imagem: s.imagem,
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(dados.length > 0 ? { dados: dados as string[] } : {}),
    ...(s.compartilhado === true ? { compartilhado: true } : {}),
  };
}

/**
 * `imagemVersao` entra como número na api (a `version` do artefato) e sai como
 * texto no rótulo `brabo.image.version` — a conversão acontece aqui e não no
 * adaptador, para o adaptador nunca precisar decidir formato de nada.
 */
function texto(valor: unknown, campo: string): string {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new EspecificacaoInvalidaError(
      campo,
      `esperava texto não vazio, recebi ${descrever(valor)}`,
    );
  }
  return valor.trim();
}

function numeroNoTeto(valor: unknown, campo: string, teto: number): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) {
    throw new EspecificacaoInvalidaError(
      campo,
      `esperava número positivo, recebi ${descrever(valor)}`,
    );
  }
  if (n > teto) {
    throw new EspecificacaoInvalidaError(
      campo,
      `${n} passa do teto de ${teto} que este processo aplica a QUALQUER ` +
        'container, venha o pedido de onde vier. Nada é rebaixado em silêncio',
    );
  }
  return n;
}

/** Descreve `unknown` para mensagem, sem o `[object Object]` de `String()`. */
function descrever(valor: unknown): string {
  if (typeof valor === 'string') return JSON.stringify(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (valor === null || valor === undefined) return String(valor);
  try {
    return JSON.stringify(valor);
  } catch {
    return '(valor não serializável)';
  }
}

function temQuebraOuNul(texto: string): boolean {
  return texto.includes("\n") || texto.includes("\r") || texto.includes("\0");
}

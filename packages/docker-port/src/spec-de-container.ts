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

import {
  raizDeProjetoValidada,
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

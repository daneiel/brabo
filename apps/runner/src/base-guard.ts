/**
 * Guarda da BASE de projetos do runner e da SUBPASTA de um projeto dentro
 * dela (ADR 0151 pontos 1 e 2, RN-529) — **terceiro irmão** de `guard.ts`,
 * ao lado de `espelho-guard.ts`.
 *
 * Irmão, e não extensão, pela mesma razão que `espelho-guard.ts` deu quando
 * nasceu: a pergunta é outra. `guard.ts` valida o `cwd` de um comando já
 * aprovado contra a raiz DAQUELE projeto; `espelho-guard.ts` valida um LAÇO
 * entre origem e destino; aqui a pergunta é *"esta pasta pode ser a base de
 * TODOS os projetos, e esta subpasta está mesmo dentro dela?"*.
 *
 * ## O que ele REUSA, e o que deliberadamente não copia
 *
 * `semBarraFinal`, `dentroDoEscopo` e `realpathMaisProximo` vêm de `guard.ts`
 * — os três helpers que deixaram de ser privados exatamente para isto
 * (`guard.ts:33-43`, RN-516) —, e a **dupla passada** léxica-depois-`realpath`
 * de `validarCwdDentroDaRaiz` é a mesma. `validarDirDentroDoHomeNoLinux`
 * (RN-434) é reusada INTEIRA para a base, não reescrita.
 *
 * A recusa de laço é a de `espelho-guard.ts` (`recusarLaco`): comparação por
 * **SEGMENTO**, nunca `startsWith` cru — `/base-outra` não está dentro de
 * `/base`, e taxá-la recusaria uma pasta irmã perfeitamente legítima. O que
 * NÃO se importa é a função `recusarLaco` em si: ela lança
 * `DestinoDeEspelhoInvalidoError`, com mensagem sobre espelho, e usá-la aqui
 * faria uma base malformada ser reportada como problema de espelho. A régua é
 * `dentroDoEscopo`, e é ela que se reusa; a mensagem é de quem recusa. Esta é
 * a **quarta pergunta**, nunca a quarta cópia da régua (RN-515).
 *
 * ## O laço aqui é ASSIMÉTRICO, e isso é o achado
 *
 * No espelho os dois sentidos são defeito. Aqui um deles é o arranjo NORMAL:
 * a raiz do projeto DENTRO da base é precisamente o que o ADR 0151 desenha
 * ("cada projeto é uma subpasta dela"). O sentido contrário — a base dentro
 * da raiz deste projeto, ou igual a ela — é que é o laço: todo projeto novo
 * nasceria dentro deste, e o `git` e o espelho deste projeto passariam a
 * varrer os outros. Só esse é recusado.
 *
 * ## A base NÃO entra na validação de `--dir` (a proibição da api, transposta)
 *
 * `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts:421-438`
 * proíbe por escrito que a regra da base desça para `caminhoDeWorkspaceLocalValido`,
 * porque aquele predicado roda em TODA LEITURA e um projeto legado fora da
 * base explodiria ao ser lido: *"A base é regra de CRIAÇÃO e CONVERSÃO; o
 * léxico é para sempre"*. O mesmo vale deste lado, e é o que faz `--dir`
 * conviver com a base sem `breaking/`: `--dir` continua validado exatamente
 * como sempre (`validarDirDentroDoHomeNoLinux` + `garantirDiretorio`), e
 * estar FORA da base não o invalida. A base só decide onde uma pasta de
 * projeto NOVA é criada.
 *
 * ## TOCTOU: a mesma ressalva de `guard.ts` e `espelho-guard.ts`, herdada
 *
 * Isto é **best-effort**, não é a fronteira de segurança. O runner roda na
 * máquina do usuário, com os privilégios dele; a fronteira real continua
 * sendo autenticação + pipeline de aprovação + o consentimento de quem rodou
 * o CLI (`guard.ts:9-31`). Um link simbólico criado DEPOIS desta checagem e
 * ANTES do `mkdir` não é coberto, nem link cujo alvo ainda não existe. O que
 * a guarda pega é o caso óbvio — um segmento que escapa da base, escrito
 * errado ou construído por link — e recusa com motivo, em vez de criar pasta
 * num lugar arbitrário sem avisar ninguém.
 */

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  dentroDoEscopo,
  DirForaDoHomeError,
  realpathMaisProximo,
  semBarraFinal,
  validarDirDentroDoHomeNoLinux,
} from './guard.ts';

export type MotivoDeRecusaDaBase =
  /** Não é string, é vazia, tem `\0`, não começa com `/`, ou tem `..` num segmento. */
  | 'lexico'
  /** A base é a raiz do sistema de arquivos — daria a cada projeto o disco inteiro. */
  | 'raiz-do-fs'
  /** No Linux, a base precisa viver dentro do `$HOME` do usuário (RN-434). */
  | 'fora-do-home'
  /** O caminho já existe no disco e não é uma pasta. */
  | 'nao-e-pasta'
  /** A base está DENTRO da raiz deste projeto (ou É ela) — todo projeto novo nasceria aqui. */
  | 'base-dentro-da-raiz';

export class BaseInvalidaError extends Error {
  // Propriedades explícitas, não parameter properties: `erasableSyntaxOnly`
  // (mesmo tsconfig de `guard.ts`) recusa a forma curta.
  readonly baseRecebida: string;
  readonly motivo: MotivoDeRecusaDaBase;

  constructor(baseRecebida: string, motivo: MotivoDeRecusaDaBase, explicacao: string) {
    super(`base de projetos recusada (${motivo}): ${JSON.stringify(baseRecebida)}. ${explicacao}`);
    this.name = 'BaseInvalidaError';
    this.baseRecebida = baseRecebida;
    this.motivo = motivo;
  }
}

export interface OpcoesDaBase {
  plataforma: NodeJS.Platform;
  home: string;
  /**
   * A raiz DESTE projeto (`estado.dir`, já resolvida por `resolverDir`) — só
   * para a recusa de laço. Ela não é validada aqui: `--dir` tem a validação
   * dele, de sempre, e a base não entra nela (ver o docblock do módulo).
   */
  raizDoProjeto: string;
}

/**
 * Valida a base consentida e devolve o caminho normalizado — ou lança
 * `BaseInvalidaError`.
 *
 * Não cria nada, e não exige que a base já exista: o instalador é quem a cria
 * (ADR 0150), e o mesmo raciocínio do ADR 0142 vale aqui — validar DISCO onde
 * só o léxico é conhecível tornaria impossível consentir uma base antes de
 * ela existir. O que se checa no disco é uma coisa só, e ela nunca é ambígua:
 * um caminho que JÁ existe e não é pasta nunca virará uma.
 */
export function validarBaseDeProjetos(baseRecebida: string, opcoes: OpcoesDaBase): string {
  if (typeof baseRecebida !== 'string' || baseRecebida.length === 0) {
    throw new BaseInvalidaError(
      String(baseRecebida),
      'lexico',
      'A base precisa ser um caminho absoluto não-vazio.',
    );
  }
  if (baseRecebida.includes('\0')) {
    throw new BaseInvalidaError(baseRecebida, 'lexico', 'A base não pode conter byte nulo.');
  }
  if (!baseRecebida.startsWith('/')) {
    // Relativa dependeria do `cwd` do PROCESSO do runner, que não tem relação
    // nenhuma com onde o usuário quer que os projetos morem.
    throw new BaseInvalidaError(baseRecebida, 'lexico', 'A base precisa começar com "/".');
  }
  if (baseRecebida.split('/').some((segmento) => segmento === '..')) {
    throw new BaseInvalidaError(
      baseRecebida,
      'lexico',
      'A base não pode ter ".." em nenhum segmento.',
    );
  }

  const base = semBarraFinal(resolve(baseRecebida));

  if (base === '/') {
    // Mesmo raciocínio de `segmentoSobABaseDeProjetos` recusando `caminho ===
    // base` do lado da api: uma base que é tudo não delimita nada.
    throw new BaseInvalidaError(
      baseRecebida,
      'raiz-do-fs',
      'A base não pode ser a raiz do sistema de arquivos — ela existe para ' +
        'delimitar onde os projetos moram, e "/" não delimita nada.',
    );
  }

  // RN-434 (ADR 0104) reusada INTEIRA, não reescrita: no Linux o workspace do
  // modo `runner` só vive dentro do `$HOME`. A base é o PAI de todos eles, e
  // validá-la aqui é o que mantém a checagem de `--dir` e esta concordando —
  // base dentro do `$HOME` implica toda subpasta dentro dele. A mensagem é
  // trocada de propósito: a de `DirForaDoHomeError` fala de `--dir`, e mandar
  // alguém corrigir a flag errada é pior que não explicar.
  try {
    validarDirDentroDoHomeNoLinux(base, opcoes.plataforma, opcoes.home);
  } catch (erro) {
    if (erro instanceof DirForaDoHomeError) {
      throw new BaseInvalidaError(
        baseRecebida,
        'fora-do-home',
        `No Linux a base precisa estar dentro do seu diretório de usuário ` +
          `(${erro.home}) — a mesma regra que já vale para --dir (RN-434). ` +
          `Escolha algo como ${erro.home}/projetos-brabo.`,
      );
    }
    throw erro;
  }

  if (existsSync(base) && !statSync(base).isDirectory()) {
    throw new BaseInvalidaError(
      baseRecebida,
      'nao-e-pasta',
      'Este caminho já existe e não é uma pasta. Este CLI nunca sobrescreve ' +
        'um arquivo existente.',
    );
  }

  recusarLacoComARaiz(base, opcoes.raizDoProjeto, baseRecebida);

  return base;
}

/**
 * A metade assimétrica do laço (ver o docblock do módulo). Comparação por
 * SEGMENTO nos dois lugares — a mesma de `espelho-guard.ts:214/223` —, mas um
 * só dos sentidos é recusa: `raiz` dentro de `base` é o arranjo que o ADR
 * 0151 desenha, e recusá-lo seria recusar o caso normal.
 *
 * A dupla passada vale aqui também: um `base` cujo pai é um symlink apontando
 * para dentro da raiz do projeto tem forma lexical impecável.
 */
function recusarLacoComARaiz(base: string, raizDoProjeto: string, baseOriginal: string): void {
  const raiz = semBarraFinal(resolve(raizDoProjeto));

  const explicacao =
    'A base está dentro da pasta deste projeto (ou É ela) — todo projeto novo ' +
    'nasceria dentro deste, e o git e o espelho deste projeto passariam a ' +
    'varrer os outros. Escolha uma base fora dele.';

  if (dentroDoEscopo(base, raiz)) {
    throw new BaseInvalidaError(baseOriginal, 'base-dentro-da-raiz', explicacao);
  }

  // Segunda passada, por REALPATH — pega o symlink num segmento do meio.
  // Best-effort: não cobre link criado DEPOIS desta checagem (TOCTOU), nem
  // link cujo alvo ainda não existe.
  if (
    dentroDoEscopo(
      semBarraFinal(realpathMaisProximo(base)),
      semBarraFinal(realpathMaisProximo(raiz)),
    )
  ) {
    throw new BaseInvalidaError(baseOriginal, 'base-dentro-da-raiz', explicacao);
  }
}

export type MotivoDeRecusaDoSegmento =
  /** Não é string, é vazio, tem `\0`, é absoluto, ou tem `..` num segmento. */
  | 'lexico'
  /** O caminho resolvido caiu FORA da base (lexicamente ou por symlink). */
  | 'escapa-da-base'
  /** O segmento aponta para a PRÓPRIA base — daria a este projeto a pasta de todos. */
  | 'e-a-propria-base';

export class SegmentoDeProjetoInvalidoError extends Error {
  readonly segmentoRecebido: string;
  readonly base: string;
  readonly motivo: MotivoDeRecusaDoSegmento;

  constructor(
    segmentoRecebido: string,
    base: string,
    motivo: MotivoDeRecusaDoSegmento,
    explicacao: string,
  ) {
    super(
      `segmento de projeto recusado (${motivo}): ${JSON.stringify(segmentoRecebido)} ` +
        `sob a base ${JSON.stringify(base)}. ${explicacao}`,
    );
    this.name = 'SegmentoDeProjetoInvalidoError';
    this.segmentoRecebido = segmentoRecebido;
    this.base = base;
    this.motivo = motivo;
  }
}

/**
 * A pasta ABSOLUTA de um projeto sob a base, a partir do SEGMENTO relativo —
 * ou lança `SegmentoDeProjetoInvalidoError`.
 *
 * O segmento é relativo porque é ele, e não um caminho absoluto, que
 * atravessa a rede: é o invariante do ADR 0130/0144 — quem tem a raiz é quem
 * executa, e o servidor manda só o pedaço que a raiz não cobre. Um segmento
 * absoluto é recusado por LÉXICO, não "aceito e reinterpretado".
 *
 * `base` chega JÁ validada e normalizada por `validarBaseDeProjetos`.
 *
 * A ORDEM é a de `validarCwdDentroDaRaiz`: léxico primeiro (barato, e cobre o
 * segmento malformado que chegou pela rede), `realpath` depois. Nada é criado
 * aqui — o `mkdir -p` acontece DEPOIS de a guarda passar, e em outro módulo,
 * como em `espelho-guard.ts`/`espelho.ts`.
 *
 * Aqui `realpathMaisProximo` basta, e `realpathPreservandoSufixo` (o de
 * `espelho-guard.ts`) seria a ferramenta errada: lá os DOIS lados podem não
 * existir, e colapsá-los no primeiro ancestral comum faria `/base-outra` e
 * `/base` virarem ambos `/`. Aqui o alvo é comparado contra uma base que
 * existe — o caso de `validarCwdDentroDaRaiz` —, e cair no ancestral só torna
 * a checagem mais frouxa, nunca errada.
 */
export function resolverPastaDoProjetoNaBase(base: string, segmentoRecebido: string): string {
  const recusa = (motivo: MotivoDeRecusaDoSegmento, explicacao: string) =>
    new SegmentoDeProjetoInvalidoError(String(segmentoRecebido), base, motivo, explicacao);

  if (typeof segmentoRecebido !== 'string' || segmentoRecebido.length === 0) {
    throw recusa('lexico', 'O segmento precisa ser um caminho relativo não-vazio.');
  }
  if (segmentoRecebido.includes('\0')) {
    throw recusa('lexico', 'O segmento não pode conter byte nulo.');
  }
  if (segmentoRecebido.startsWith('/')) {
    throw recusa(
      'lexico',
      'O segmento é RELATIVO à base por contrato (ADR 0130): nenhum caminho ' +
        'absoluto atravessa a rede, porque quem tem a raiz é quem executa.',
    );
  }
  if (segmentoRecebido.split('/').some((parte) => parte === '..')) {
    throw recusa('lexico', 'O segmento não pode ter ".." em nenhum segmento.');
  }

  const alvo = semBarraFinal(resolve(join(base, segmentoRecebido)));

  if (alvo === base) {
    // `.`, `./`, `foo/..` já barrado acima — o que sobra é o segmento que
    // resolve para a própria base. Recusa e NÃO segmento vazio, pelo mesmo
    // motivo de `segmentoSobABaseDeProjetos` do lado da api: dar a este
    // projeto a base inteira é dar a ele a pasta de todos os outros.
    throw recusa(
      'e-a-propria-base',
      'O segmento aponta para a PRÓPRIA base — isso daria a este projeto a ' +
        'pasta de todos os outros.',
    );
  }

  // Primeira passada — LÉXICA, por SEGMENTO (`dentroDoEscopo`), nunca
  // `startsWith` cru.
  if (!dentroDoEscopo(alvo, base)) {
    throw recusa('escapa-da-base', 'O caminho resolvido cai fora da base.');
  }

  // Segunda passada — por REALPATH. É esta que pega um segmento do MEIO que
  // existe e é um symlink apontando para fora da base, cuja forma lexical
  // está impecável. Best-effort (ver o docblock do módulo).
  const baseReal = semBarraFinal(realpathMaisProximo(base));
  const alvoReal = semBarraFinal(realpathMaisProximo(alvo));
  if (!dentroDoEscopo(alvoReal, baseReal)) {
    throw recusa(
      'escapa-da-base',
      'O caminho resolvido cai fora da base depois de resolver os links ' +
        'simbólicos do meio.',
    );
  }

  return alvo;
}

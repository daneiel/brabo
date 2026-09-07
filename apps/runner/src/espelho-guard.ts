/**
 * Guarda do DESTINO do espelho (ADR 0147 ponto 2, RN-516) — **irmão de
 * `guard.ts`, não uma extensão dele**.
 *
 * Irmão porque responde outra pergunta. `guard.ts` valida o `cwd` de um
 * comando já aprovado: "isto está DENTRO da raiz do projeto?". Aqui a
 * pergunta é sobre um LAÇO entre duas pastas que existem ao mesmo tempo — a
 * origem (o workspace do projeto, `--dir` da CLI) e o destino (a pasta que o
 * usuário declarou em `projects.mirror_path`, RN-515) — e a recusa é
 * simétrica: nenhuma das duas pode estar dentro da outra.
 *
 * O que ele REUSA de `guard.ts` são os três helpers de comparação de caminho
 * (`semBarraFinal`, `dentroDoEscopo`, `realpathMaisProximo`) e, principalmente,
 * a **dupla passada** de `validarCwdDentroDaRaiz` (`guard.ts:146-182`): a
 * primeira é léxica, a segunda resolve `realpath` — e é a segunda que pega um
 * symlink num segmento do MEIO, cuja forma lexical está perfeitamente dentro
 * do escopo.
 *
 * ## A passada de `realpath` NÃO é redundante com a da api
 *
 * A api já recusou a metade LÉXICA deste mesmo laço
 * (`validarDestinoDeEspelho` em `workspace-location.ts`, RN-515) — e ela diz,
 * no próprio código, que é só o léxico: a api **não tem disco** onde resolver
 * um symlink do computador do usuário. `destino/atalho -> /caminho/do/projeto`
 * passa por lá sem ser visto, e é aqui — na máquina onde os dois caminhos
 * existem de verdade — que ele é resolvido. Repetir o léxico aqui é barato e
 * é defesa em profundidade (o destino chega pela rede); o que **só** existe
 * aqui é o `realpath`.
 *
 * ## TOCTOU: a mesma ressalva de `guard.ts`, herdada por escrito
 *
 * Isto é **best-effort**, não fronteira de segurança. O runner roda na
 * máquina do usuário, com os privilégios dele; a fronteira real continua
 * sendo autenticação + pipeline de aprovação + o consentimento de quem rodou
 * o CLI. Um link simbólico criado DEPOIS desta checagem e ANTES da escrita
 * não é coberto, nem link cujo alvo ainda não existe. O que a guarda faz é
 * pegar o caso óbvio — um destino que se sobrepõe à origem, escrito à mão ou
 * construído por link — e recusar com motivo, em vez de escrever numa pasta
 * arbitrária sem avisar ninguém.
 *
 * ## Por que o laço importa tanto
 *
 * Com o bind por identidade do ADR 0141, escrever o espelho DENTRO da origem
 * faz o espelho copiar o próprio espelho — a cada rodada, mais uma camada. E
 * a origem dentro do destino é o mesmo laço no sentido contrário. Recusar um
 * e permitir o outro seria fechar a porta e deixar a janela.
 */

import { existsSync, lstatSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dentroDoEscopo, realpathMaisProximo, semBarraFinal } from './guard.ts';

export type MotivoDeRecusaDoEspelho =
  /** Não é string, é vazio, tem `\0`, não começa com `/`, ou tem `..` num segmento. */
  | 'lexico'
  /** O destino está DENTRO da pasta do projeto — o espelho copiaria o próprio espelho. */
  | 'destino-dentro-do-workspace'
  /** O destino CONTÉM a pasta do projeto — o mesmo laço, no sentido contrário. */
  | 'destino-contem-o-workspace';

export class DestinoDeEspelhoInvalidoError extends Error {
  // Propriedades explícitas, não parameter properties: `erasableSyntaxOnly`
  // (mesmo tsconfig de `guard.ts`) recusa a forma curta.
  readonly destino: string;
  readonly workspace: string;
  readonly motivo: MotivoDeRecusaDoEspelho;

  constructor(
    destino: string,
    workspace: string,
    motivo: MotivoDeRecusaDoEspelho,
    explicacao: string,
  ) {
    super(
      `destino de espelho recusado (${motivo}): ${JSON.stringify(destino)} ` +
        `contra a pasta do projeto ${JSON.stringify(workspace)}. ${explicacao}`,
    );
    this.name = 'DestinoDeEspelhoInvalidoError';
    this.destino = destino;
    this.workspace = workspace;
    this.motivo = motivo;
  }
}

/** `/a/b/` e `/a/b` são o MESMO caminho — normaliza os dois antes de comparar. */
export function mesmoCaminho(a: string, b: string): boolean {
  return normalizar(a) === normalizar(b);
}

function normalizar(caminho: string): string {
  return semBarraFinal(resolve(caminho));
}

export interface DestinoValidado {
  /** O destino normalizado LEXICAMENTE (o que se cria com `mkdir -p`). */
  destino: string;
  /** A origem normalizada lexicamente. */
  workspace: string;
}

/**
 * Valida o destino do espelho contra a pasta do projeto — ou lança
 * `DestinoDeEspelhoInvalidoError`.
 *
 * A ORDEM é a de `validarCwdDentroDaRaiz`: léxico primeiro (barato, e cobre o
 * destino malformado que chegou pela rede), `realpath` depois (o que pega o
 * symlink). Nenhuma pasta é criada aqui — `mkdir -p` só acontece DEPOIS de a
 * guarda passar, em `espelho.ts`.
 */
export function validarDestinoDeEspelho(
  destinoRecebido: string,
  workspaceRecebido: string,
): DestinoValidado {
  if (typeof destinoRecebido !== 'string' || destinoRecebido.length === 0) {
    throw new DestinoDeEspelhoInvalidoError(
      String(destinoRecebido),
      workspaceRecebido,
      'lexico',
      'O destino precisa ser um caminho absoluto não-vazio.',
    );
  }
  if (destinoRecebido.includes('\0')) {
    throw new DestinoDeEspelhoInvalidoError(
      destinoRecebido,
      workspaceRecebido,
      'lexico',
      'O destino não pode conter byte nulo.',
    );
  }
  if (!destinoRecebido.startsWith('/')) {
    // Relativo dependeria do `cwd` do PROCESSO do runner, que não é nem a
    // origem nem o destino — e a api já grava caminho absoluto (RN-515).
    throw new DestinoDeEspelhoInvalidoError(
      destinoRecebido,
      workspaceRecebido,
      'lexico',
      'O destino precisa começar com "/".',
    );
  }
  if (destinoRecebido.split('/').some((segmento) => segmento === '..')) {
    throw new DestinoDeEspelhoInvalidoError(
      destinoRecebido,
      workspaceRecebido,
      'lexico',
      'O destino não pode ter ".." em nenhum segmento.',
    );
  }

  const destino = normalizar(destinoRecebido);
  const workspace = normalizar(workspaceRecebido);

  // Primeira passada — LÉXICA. Os dois sentidos do mesmo laço, por SEGMENTO
  // (`dentroDoEscopo`), nunca `startsWith` cru: `/base-outra` NÃO está dentro
  // de `/base`, e recusá-lo taxaria uma pasta irmã perfeitamente legítima.
  recusarLaco(destino, workspace, destinoRecebido, workspaceRecebido);

  // Segunda passada — por REALPATH. É esta que pega o symlink num segmento do
  // meio: `/home/voce/espelho` cuja pasta `espelho` é um link para dentro do
  // projeto tem forma lexical impecável e é exatamente o laço que a primeira
  // passada não vê. Best-effort (ver o docblock): não cobre link criado
  // DEPOIS desta checagem (TOCTOU), nem link cujo alvo ainda não existe.
  //
  // O SUFIXO é preservado, e isso é o que diferencia esta guarda do uso que
  // `validarCwdDentroDaRaiz` faz de `realpathMaisProximo`. Lá o caminho é
  // sempre comparado CONTRA uma raiz que existe, e cair no ancestral só torna
  // a checagem mais frouxa. Aqui os DOIS lados podem não existir — o destino
  // quase nunca existe, porque é o `mkdir -p` desta rodada que o cria — e
  // colapsar os dois no primeiro ancestral comum faria `/base-outra` e
  // `/base` virarem ambos `/`, e a guarda recusaria toda pasta irmã.
  // `realpathPreservandoSufixo` resolve o ancestral que EXISTE (é aí que o
  // symlink mora) e recoloca o resto do caminho por cima.
  const destinoReal = realpathPreservandoSufixo(destino);
  const workspaceReal = realpathPreservandoSufixo(workspace);
  recusarLaco(destinoReal, workspaceReal, destinoRecebido, workspaceRecebido);

  return { destino, workspace };
}

/**
 * O `realpath` de um caminho que pode ainda não existir, **sem perder o que
 * falta**: resolve o primeiro ancestral que existe (reusando
 * `realpathMaisProximo` de `guard.ts`, que sobre um caminho existente é o
 * `realpathSync` puro) e recoloca por cima os segmentos que sobraram.
 *
 * Um symlink só pode morar num segmento que EXISTE, então o que sobra nunca
 * esconde link nenhum — e preservá-lo é o que mantém duas pastas irmãs
 * distinguíveis quando nenhuma das duas foi criada ainda.
 */
function realpathPreservandoSufixo(caminho: string): string {
  const normalizado = semBarraFinal(resolve(caminho));
  const sufixo: string[] = [];
  let existente = normalizado;

  // Teto: número de segmentos é o máximo de subidas possíveis até a raiz do
  // FS — mesma disciplina de `realpathMaisProximo`, nunca laço sem fim.
  const teto = normalizado.split('/').length + 1;
  for (let tentativa = 0; tentativa < teto && !existsSync(existente); tentativa++) {
    const pai = resolve(existente, '..');
    if (pai === existente) return normalizado; // nem a raiz do FS existe
    sufixo.unshift(basename(existente));
    existente = pai;
  }

  if (!existsSync(existente)) return normalizado;
  return semBarraFinal(join(realpathMaisProximo(existente), ...sufixo));
}

function recusarLaco(
  destino: string,
  workspace: string,
  destinoOriginal: string,
  workspaceOriginal: string,
): void {
  if (dentroDoEscopo(destino, workspace)) {
    throw new DestinoDeEspelhoInvalidoError(
      destinoOriginal,
      workspaceOriginal,
      'destino-dentro-do-workspace',
      'O destino está dentro da pasta do projeto — o espelho passaria a ' +
        'copiar o próprio espelho, a cada rodada. Escolha uma pasta fora dela.',
    );
  }
  if (dentroDoEscopo(workspace, destino)) {
    throw new DestinoDeEspelhoInvalidoError(
      destinoOriginal,
      workspaceOriginal,
      'destino-contem-o-workspace',
      'O destino CONTÉM a pasta do projeto — é o mesmo laço, no sentido ' +
        'contrário: a origem passaria a viver dentro do destino. Escolha uma ' +
        'pasta que não seja ancestral dela.',
    );
  }
}

/**
 * Segunda metade da recusa (1) do ADR 0147 — **symlink que escape do
 * destino**, por ARQUIVO.
 *
 * `validarDestinoDeEspelho` prova que a PASTA do destino não se sobrepõe à
 * origem. Isto prova que cada caminho onde o espelho vai de fato ESCREVER
 * continua dentro dela: um `destino/sub` que é link para `/etc` faria a cópia
 * de `sub/passwd` escrever fora, com o destino em si perfeitamente válido.
 *
 * Mesma dupla passada, mesma ressalva de TOCTOU. `alvo` pode ainda não
 * existir — `realpathMaisProximo` resolve o primeiro ancestral que existe, e
 * é justamente o ancestral que carrega o link.
 */
export function caminhoNoDestino(alvo: string, destinoReal: string): boolean {
  const raiz = semBarraFinal(resolve(destinoReal));
  const alvoNormalizado = semBarraFinal(resolve(alvo));
  if (!dentroDoEscopo(alvoNormalizado, raiz)) return false;
  return dentroDoEscopo(semBarraFinal(realpathMaisProximo(alvoNormalizado)), raiz);
}

/**
 * `true` só para arquivo REGULAR — `lstat`, nunca `stat`, porque a diferença
 * é o ponto: um symlink na origem não é seguido (copiar o alvo dele traria
 * conteúdo de fora do projeto para a pasta pessoal de alguém), e diretório,
 * FIFO e socket também não são espelhados. Caminho inexistente devolve
 * `false` em vez de lançar — um arquivo que o `git` listou e sumiu antes da
 * cópia é corrida normal, não erro.
 */
export function arquivoRegular(caminho: string): boolean {
  try {
    return lstatSync(caminho).isFile();
  } catch {
    return false;
  }
}

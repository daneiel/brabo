/**
 * A CRIAÇÃO da pasta de um projeto sob a base (ADR 0151 ponto 3, RN-532) — o
 * trabalho de disco que `workspace_create` pede, separado de quem fala pelo
 * canal, exatamente como `espelho.ts` é separado de `tratarMirrorSync`.
 *
 * ## O que atravessa a rede é o SEGMENTO, e este módulo é quem tem a raiz
 *
 * A base é LOCAL (RN-529): consentida no instalador, lida de um arquivo do
 * usuário, nunca recebida do servidor. O engine manda `projectId` e o
 * **segmento relativo**, e é `resolverPastaDoProjetoNaBase` (`base-guard.ts`)
 * quem os junta — recusando por LÉXICO um segmento absoluto, em vez de
 * "aceitar e reinterpretar". É o invariante do ADR 0130/0144 aplicado ao
 * agente local: quem tem a raiz é quem executa.
 *
 * ## Idempotente, e a idempotência é do PRODUTO, não deste arquivo
 *
 * `mkdir -p` já é idempotente; o que precisou de decisão foi o git. Uma pasta
 * que JÁ é repositório (`.git` presente) volta como sucesso, com o modo
 * `ja-era-repositorio` — nunca um `git init` por cima (que é inofensivo mas
 * mentiria sobre o que aconteceu) e nunca um `clone` (que falharia por pasta
 * não-vazia e transformaria "já estava pronto" em erro). É a mesma disposição
 * de `ConfirmProjectWorkspaceUseCase`, que é idempotente pelo mesmo motivo: a
 * mensagem pode chegar duas vezes, e a segunda não pode ser pior que a
 * primeira.
 *
 * ## `git init` OU `clone`, e quem decide é o pedido — nunca este módulo
 *
 * Sem `repoUrl` é `git init`: uma pasta de trabalho vazia, que é o que um
 * projeto novo precisa. Com `repoUrl` é `git clone`, e ele roda no HOST do
 * usuário, com o `env` que veio no pedido — o MESMO mecanismo que a RN-507/ADR
 * 0145 criou para o `git` credenciado do `exec` (mesclado sobre `process.env`,
 * nunca substituindo, e nunca logado). É por isso que o ADR 0151 declara nas
 * Consequences que este clone não sofre da lacuna da credencial descartada no
 * `docker exec`: ele nunca passa por container.
 *
 * Git que falha vira erro NOMEADO. Nunca um plano B — não existe "criar a
 * pasta e desistir do repositório em silêncio", porque uma pasta sem `.git`
 * quebraria tudo que vem depois (o worktree do dev agent, o espelho, o
 * `git status` que o usuário vai rodar) num lugar longe da causa.
 *
 * ## Nada aqui muda `estado.dir`, e isso é decisão
 *
 * A pasta criada é a do projeto do ponto de vista do SERVIDOR — e é o
 * `workspace_confirm` (RN-423) que a grava. `estado.dir` continua sendo a raiz
 * que `guard.ts` usa para conter comando aprovado, e trocá-la em runtime moveria
 * uma fronteira de contenção por causa de uma mensagem de rede, que é
 * exatamente o que este CLI nunca faz. Reconectar apontando para a pasta nova é
 * assunto do runner por máquina (FASE 30), declarado no ADR 0151.
 *
 * ## TOCTOU: a mesma ressalva de `base-guard.ts`, herdada
 *
 * Best-effort, e não é a fronteira de segurança. Um symlink criado DEPOIS da
 * guarda e ANTES do `mkdir` não é coberto. A fronteira continua sendo
 * autenticação + pipeline de aprovação + o consentimento de quem rodou o CLI.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolverPastaDoProjetoNaBase, SegmentoDeProjetoInvalidoError } from './base-guard.ts';
import { DirNaoEUmaPastaError, garantirDiretorio, NaoConsegiuCriarDiretorioError } from './guard.ts';

/** `git init`/`clone` não deve levar isto; se levar, algo está errado. */
const TIMEOUT_DO_GIT_MS = 120_000;

/** Teto de saída do git — nunca truncado em silêncio. */
const TETO_DE_SAIDA_DO_GIT = 8 * 1024 * 1024;

/**
 * O motivo NOMEADO da recusa, que viaja em `workspace_create_result.motivo` e
 * é o que o engine traduz. Existe separado da mensagem porque a mensagem é
 * para um humano ler e o motivo é para o outro lado DECIDIR: colapsar os dois
 * obrigaria o engine a casar substring de texto em pt-BR.
 */
export type MotivoDaRecusaDaCriacao =
  /** Este runner está rodando SEM base consentida — não há onde criar. */
  | 'sem-base'
  /** O segmento não passou na guarda (`base-guard.ts`). */
  | 'segmento'
  /** O alvo já existe no disco e não é uma pasta. */
  | 'nao-e-pasta'
  /** O `mkdir -p` falhou (permissão, disco cheio). */
  | 'mkdir'
  /** O `git init`/`git clone` falhou. */
  | 'git';

export class CriacaoDePastaRecusadaError extends Error {
  // Propriedades explícitas, não parameter properties: `erasableSyntaxOnly`
  // (mesmo tsconfig de `guard.ts`) recusa a forma curta.
  readonly motivo: MotivoDaRecusaDaCriacao;

  constructor(motivo: MotivoDaRecusaDaCriacao, explicacao: string) {
    super(explicacao);
    this.name = 'CriacaoDePastaRecusadaError';
    this.motivo = motivo;
  }
}

/**
 * O que ACONTECEU, e os três não colapsam (RN-088): repositório recém-criado,
 * clonado, ou uma pasta que já era repositório antes deste pedido. "Já
 * existia" é sucesso e não vazio — quem lê o log precisa distinguir a rodada
 * que fez trabalho da que não tinha o que fazer.
 */
export type ModoDaCriacao = 'init' | 'clone' | 'ja-era-repositorio';

export interface ResultadoDaCriacao {
  /** O caminho ABSOLUTO final, o mesmo que vai no `workspace_confirm`. */
  caminho: string;
  modo: ModoDaCriacao;
}

export interface CriarPastaDoProjetoOpts {
  /** A base consentida desta máquina (`EstadoDoRunner.base`) — `null` recusa. */
  base: string | null;
  /** O segmento RELATIVO à base, como veio do engine. */
  segmento: string;
  /** Sem ela é `git init`; com ela é `git clone`. */
  repoUrl?: string;
  /** Credencial de git (ADR 0056/0145) — mesclada sobre `process.env`, nunca logada. */
  env?: Record<string, string>;
  /** Injetável só para teste — default: o `git` de verdade. */
  rodarGit?: (cwd: string, args: string[], env?: Record<string, string>) => Promise<void>;
}

/**
 * Cria (ou reconhece) a pasta do projeto sob a base e garante que ela é um
 * repositório git. Lança `CriacaoDePastaRecusadaError` com o motivo NOMEADO;
 * nunca lança nada mais — quem chama transforma isso em
 * `workspace_create_result`, jamais numa exceção que derruba o runner.
 */
export async function criarPastaDoProjeto(
  opts: CriarPastaDoProjetoOpts,
): Promise<ResultadoDaCriacao> {
  const git = opts.rodarGit ?? rodarGitDeVerdade;

  if (!opts.base) {
    throw new CriacaoDePastaRecusadaError(
      'sem-base',
      'este brabo-runner está rodando SEM base de projetos consentida, então não ' +
        'há onde criar a pasta. Rode o instalador para consentir uma base, ou ' +
        'passe --base <caminho> nesta execução (ADR 0151, RN-529).',
    );
  }

  // 1. A guarda PRIMEIRO, sempre — nada é criado antes de ela passar.
  let alvo: string;
  try {
    alvo = resolverPastaDoProjetoNaBase(opts.base, opts.segmento);
  } catch (erro) {
    if (erro instanceof SegmentoDeProjetoInvalidoError) {
      throw new CriacaoDePastaRecusadaError('segmento', erro.message);
    }
    throw erro;
  }

  // 2. Só então o disco. `garantirDiretorio` é REUSADA (`mkdir -p`, mais a
  //    recusa de sobrescrever arquivo existente) e as mensagens dela são
  //    TROCADAS: elas falam de `--dir`, e mandar alguém corrigir a flag errada
  //    é pior que não explicar. Mesma disposição de `base-guard.ts` com
  //    `DirForaDoHomeError` (RN-529).
  try {
    garantirDiretorio(alvo);
  } catch (erro) {
    if (erro instanceof DirNaoEUmaPastaError) {
      throw new CriacaoDePastaRecusadaError(
        'nao-e-pasta',
        `${alvo} já existe e não é uma pasta. Este CLI nunca sobrescreve um ` +
          `arquivo existente.`,
      );
    }
    if (erro instanceof NaoConsegiuCriarDiretorioError) {
      throw new CriacaoDePastaRecusadaError('mkdir', erro.message);
    }
    throw erro;
  }

  // 3. Já é repositório? Então o pedido já está atendido — e dizer QUAL dos
  //    três desfechos foi é o que impede "não fez nada" de se disfarçar de
  //    "criou agora".
  if (existsSync(join(alvo, '.git'))) {
    return { caminho: alvo, modo: 'ja-era-repositorio' };
  }

  const url = opts.repoUrl;
  try {
    if (url !== undefined && url.length > 0) {
      // `--` separa a URL dos argumentos: uma "URL" começando com `-` seria
      // lida como flag do git, e este valor vem pela rede.
      await git(alvo, ['clone', '--', url, '.'], opts.env);
      return { caminho: alvo, modo: 'clone' };
    }

    await git(alvo, ['init'], opts.env);
    return { caminho: alvo, modo: 'init' };
  } catch (erro) {
    throw new CriacaoDePastaRecusadaError(
      'git',
      `a pasta ${alvo} foi criada, mas o git falhou: ` +
        `${erro instanceof Error ? erro.message : String(erro)}. ` +
        `Nenhum plano B foi tentado — uma pasta sem repositório quebraria o ` +
        `worktree do dev agent, o espelho e o próprio git do usuário longe da causa.`,
    );
  }
}

/**
 * O `git` de verdade, com o mesmo desenho de `espelho.ts`: `execFile` (nunca
 * shell), teto de saída, timeout — e `env` MESCLADO sobre `process.env`,
 * nunca substituindo (substituir perderia o `PATH` e o git nem seria achado).
 * O conteúdo de `env` NUNCA é logado.
 */
function rodarGitDeVerdade(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<void> {
  return new Promise((resolvePromise, rejeitar) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: TETO_DE_SAIDA_DO_GIT,
        timeout: TIMEOUT_DO_GIT_MS,
        env: env ? { ...process.env, ...env } : process.env,
      },
      (erro, _stdout, stderr) => {
        if (erro) {
          rejeitar(new Error((stderr || erro.message || '').toString().trim() || 'git falhou'));
          return;
        }
        resolvePromise();
      },
    );
  });
}

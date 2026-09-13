/**
 * O ESPELHO (ADR 0147 ponto 2, RN-516) — copia o trabalho do projeto para a
 * pasta que o usuário declarou (`projects.mirror_path`, RN-515), na máquina
 * dele, com o processo dele.
 *
 * ## Uma direção, e NUNCA apaga
 *
 * Workspace → destino. **Nunca `--delete`, nunca `unlink`, nunca `rm`.**
 * Arquivo apagado no workspace **permanece** no destino. Isso é decisão, não
 * descuido: a pasta do usuário não é réplica, é acúmulo — e um agente que
 * apaga arquivo na pasta pessoal de alguém por causa de um `git clean` do
 * outro lado é exatamente o tipo de surpresa que o produto existe para não
 * produzir. Sobrescrever arquivo que mudou é esperado; remover nunca é.
 *
 * O preço está declarado no ADR: sem `--delete`, o destino só cresce, e
 * nenhum mecanismo automático o limpa.
 *
 * ## O que se copia é a LISTA DO GIT, e nada mais
 *
 * Os arquivos **rastreados** (`git ls-files`) mais os **não-rastreados que não
 * são ignorados** (`git ls-files --others --exclude-standard`). Isso é
 * exatamente "o trabalho": pula `node_modules`, `dist`, saída de build e o
 * próprio `.git` **sem manter lista de exclusão nenhuma**, que envelheceria a
 * cada stack nova. O `.gitignore` do projeto já é a lista, mantida por quem
 * mantém o projeto.
 *
 * O workspace é repositório git **por construção** — o produto provisiona
 * Gitflow nele (Fase 2) e o materializa com `git init`/`fetch`/`checkout`
 * (`Engine.Actions.Workspace`) —, então a pré-condição é do PRODUTO, não uma
 * suposição sobre a máquina. Se o `git` falhar ou a pasta não for um
 * repositório, o espelho **falha com motivo nomeado**: nunca cai num `cp -r`
 * de tudo como plano B, que é como `node_modules` inteiro acabaria na pasta
 * pessoal de alguém.
 *
 * ## Repositório git ANINHADO não é descido — e isso é o desenho
 *
 * `git ls-files --others` devolve um repositório aninhado como UMA entrada de
 * diretório (com barra no fim), sem listar o conteúdo dele. Consequência
 * verificada e declarada: o worktree de cada dev agent
 * (`<workspace>/.worktrees/<agent_id>`, `Engine.Dev.WorktreeManager`) é um
 * desses — o espelho mostra o **checkout principal** do projeto, nunca o
 * trabalho ainda isolado no worktree de um agente. Entradas de diretório são
 * puladas e CONTADAS, nunca engolidas.
 *
 * ## Sem comparação de mtime: copia sempre
 *
 * Nenhuma heurística de "mudou?" (tamanho + mtime, o truque do rsync): duas
 * escritas no mesmo segundo com o mesmo tamanho fariam o espelho pular um
 * arquivo que MUDOU, em silêncio, e um espelho que às vezes não copia é pior
 * que um espelho lento. O custo é copiar bytes já iguais; o teto é a lista do
 * git, não a pasta inteira.
 */

import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  arquivoRegular,
  caminhoNoDestino,
  validarDestinoDeEspelho,
} from './espelho-guard.ts';
import { realpathMaisProximo, semBarraFinal } from './guard.ts';

/** Teto de saída do `git ls-files` — repositório muito grande falha ALTO, nunca truncado. */
const TETO_DE_SAIDA_DO_GIT = 32 * 1024 * 1024;

/** O `git` não deve levar isto num `ls-files`; se levar, algo está errado. */
const TIMEOUT_DO_GIT_MS = 30_000;

export class EspelhoSemRepositorioError extends Error {
  readonly workspace: string;
  readonly detalhe: string;

  constructor(workspace: string, detalhe: string) {
    super(
      `o espelho não conseguiu listar o trabalho de ${JSON.stringify(workspace)} ` +
        `com o git: ${detalhe}. O espelho copia a LISTA DO GIT (rastreados + ` +
        `não-rastreados-não-ignorados) e nada mais — sem ela não há o que ` +
        `copiar, e copiar a pasta inteira levaria node_modules, .git e saída ` +
        `de build para a sua pasta. Confira que a pasta do projeto é um ` +
        `repositório git e que o \`git\` está no PATH.`,
    );
    this.name = 'EspelhoSemRepositorioError';
    this.workspace = workspace;
    this.detalhe = detalhe;
  }
}

export interface ResultadoDoEspelho {
  /** O destino de verdade, resolvido por `realpath` depois do `mkdir -p`. */
  destino: string;
  /** Arquivos regulares copiados nesta rodada. */
  copiados: number;
  /**
   * Entradas que o git listou e não são arquivo regular — diretório
   * (repositório aninhado, inclusive o worktree de um dev agent), symlink,
   * ou arquivo que sumiu entre a listagem e a cópia.
   */
  pulados: number;
  /** Alvos que a guarda por arquivo recusou (symlink escapando do destino). */
  recusados: number;
}

export interface SincronizarEspelhoOpts {
  /** A raiz do projeto — `--dir` da CLI, já validada no startup (`guard.ts`). */
  workspace: string;
  /** O destino CONCEDIDO no join desta conexão (ADR 0147 ponto 4). */
  destino: string;
  /** Injetável só para teste — default: a lista do git de verdade. */
  listarArquivos?: (workspace: string) => Promise<string[]>;
}

/**
 * Roda UMA rodada do espelho. Lança `DestinoDeEspelhoInvalidoError` (guarda) ou
 * `EspelhoSemRepositorioError` (listagem) — quem chama traduz em log; nenhuma
 * falha aqui derruba o runner nem vira fallback silencioso.
 */
export async function sincronizarEspelho(
  opts: SincronizarEspelhoOpts,
): Promise<ResultadoDoEspelho> {
  const listar = opts.listarArquivos ?? listarArquivosDoGit;

  // 1. A guarda PRIMEIRO, sempre. Nada é criado antes de ela passar — um
  //    `mkdir -p` num destino que se sobrepõe à origem já teria feito o
  //    estrago que a recusa existe para evitar.
  const { destino, workspace } = validarDestinoDeEspelho(opts.destino, opts.workspace);

  // 2. Só então os diretórios intermediários do destino.
  mkdirSync(destino, { recursive: true });

  // Agora o destino existe de verdade: o `realpath` dele deixa de ser o do
  // ancestral mais próximo e vira o exato, que é a âncora das checagens por
  // arquivo abaixo.
  const destinoReal = semBarraFinal(realpathMaisProximo(destino));

  // 3. A lista do git — e ela é a ÚNICA fonte.
  const relativos = await listar(workspace);

  let copiados = 0;
  let pulados = 0;
  let recusados = 0;

  for (const relativo of relativos) {
    // Entrada de DIRETÓRIO (repositório aninhado, worktree de dev agent):
    // o git a devolve com barra no fim e não desce nela. Nem nós.
    if (relativo.length === 0 || relativo.endsWith('/')) {
      pulados++;
      continue;
    }

    const origem = join(workspace, relativo);
    if (!arquivoRegular(origem)) {
      pulados++;
      continue;
    }

    const alvo = join(destinoReal, relativo);
    // A guarda por ARQUIVO roda ANTES do `mkdir` do diretório-pai: um pai que
    // já é symlink para fora faria o próprio `mkdir -p` criar pasta fora do
    // destino, antes de qualquer cópia.
    if (!caminhoNoDestino(alvo, destinoReal)) {
      recusados++;
      continue;
    }

    mkdirSync(dirname(alvo), { recursive: true });
    copyFileSync(origem, alvo);
    copiados++;
  }

  return { destino: destinoReal, copiados, pulados, recusados };
}

/**
 * A lista do git: rastreados + não-rastreados-não-ignorados, deduplicada e
 * ordenada. `-z` (NUL como separador) e não linha: sem ele o git ESCAPA e
 * aspeia caminho com espaço, acento ou quebra de linha, e o espelho copiaria
 * para um nome que não é o do arquivo.
 */
export async function listarArquivosDoGit(workspace: string): Promise<string[]> {
  const rastreados = await git(workspace, ['ls-files', '-z']);
  const outros = await git(workspace, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);

  const todos = new Set([...separarPorNul(rastreados), ...separarPorNul(outros)]);
  return [...todos].sort();
}

function separarPorNul(saida: string): string[] {
  return saida.split('\0').filter((entrada) => entrada.length > 0);
}

function git(workspace: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejeitar) => {
    execFile(
      'git',
      args,
      { cwd: workspace, maxBuffer: TETO_DE_SAIDA_DO_GIT, timeout: TIMEOUT_DO_GIT_MS },
      (erro, stdout, stderr) => {
        if (erro) {
          const detalhe = (stderr || erro.message || '').toString().trim();
          rejeitar(new EspelhoSemRepositorioError(workspace, detalhe));
          return;
        }
        resolvePromise(stdout.toString());
      },
    );
  });
}

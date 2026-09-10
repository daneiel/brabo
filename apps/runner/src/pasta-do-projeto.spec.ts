import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  criarPastaDoProjeto,
  CriacaoDePastaRecusadaError,
} from './pasta-do-projeto.ts';

/**
 * A CRIAÇÃO da pasta de um projeto sob a base (ADR 0151 ponto 3, RN-532).
 *
 * O `git` é INJETADO na maioria dos casos — o que se prova aqui é a ORDEM
 * (guarda, depois disco, depois git) e os desfechos NOMEADOS, não que o git
 * funciona. Um caso usa o git de verdade, e ele é o que prova que a
 * idempotência não é uma afirmação sobre o mock.
 */

let raiz: string;

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'brabo-pasta-'));
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

describe('criarPastaDoProjeto — caminho feliz', () => {
  it('cria a pasta sob a base e roda `git init` quando não há repoUrl', async () => {
    const base = join(raiz, 'projetos');
    mkdirSync(base);
    const git = vi.fn(async () => undefined);

    const resultado = await criarPastaDoProjeto({ base, segmento: 'loja', rodarGit: git });

    expect(resultado).toEqual({ caminho: join(base, 'loja'), modo: 'init' });
    expect(existsSync(join(base, 'loja'))).toBe(true);
    expect(git).toHaveBeenCalledWith(join(base, 'loja'), ['init'], undefined);
  });

  it('com repoUrl, CLONA — e a URL vai depois de `--`, nunca como flag', async () => {
    const base = join(raiz, 'projetos');
    mkdirSync(base);
    const git = vi.fn(async () => undefined);

    const resultado = await criarPastaDoProjeto({
      base,
      segmento: 'loja',
      repoUrl: 'https://exemplo/loja.git',
      // A credencial (ADR 0056/0145) viaja no `env` e roda no HOST — este é o
      // caminho que a lacuna do `docker exec` não alcança.
      env: { GIT_ASKPASS: '/bin/true' },
      rodarGit: git,
    });

    expect(resultado.modo).toBe('clone');
    expect(git).toHaveBeenCalledWith(
      join(base, 'loja'),
      ['clone', '--', 'https://exemplo/loja.git', '.'],
      { GIT_ASKPASS: '/bin/true' },
    );
  });

  it('segmento com subpastas cria a árvore inteira (mkdir -p)', async () => {
    const base = join(raiz, 'projetos');
    const git = vi.fn(async () => undefined);

    const resultado = await criarPastaDoProjeto({
      base,
      segmento: 'time-a/loja',
      rodarGit: git,
    });

    expect(resultado.caminho).toBe(join(base, 'time-a', 'loja'));
    expect(existsSync(resultado.caminho)).toBe(true);
  });

  it('pasta que JÁ é repositório volta como sucesso `ja-era-repositorio`, sem tocar no git', async () => {
    // Idempotência: a mensagem pode chegar duas vezes, e a segunda não pode
    // ser pior que a primeira — nem um `init` por cima (que mentiria sobre o
    // que aconteceu), nem um `clone` (que falharia por pasta não-vazia).
    const base = join(raiz, 'projetos');
    mkdirSync(join(base, 'loja', '.git'), { recursive: true });
    const git = vi.fn(async () => undefined);

    const resultado = await criarPastaDoProjeto({
      base,
      segmento: 'loja',
      repoUrl: 'https://exemplo/loja.git',
      rodarGit: git,
    });

    expect(resultado).toEqual({ caminho: join(base, 'loja'), modo: 'ja-era-repositorio' });
    expect(git).not.toHaveBeenCalled();
  });

  it('o `git init` de VERDADE deixa a pasta reconhecível na segunda rodada', async () => {
    const base = join(raiz, 'projetos');

    const primeira = await criarPastaDoProjeto({ base, segmento: 'loja' });
    expect(primeira.modo).toBe('init');

    const segunda = await criarPastaDoProjeto({ base, segmento: 'loja' });
    expect(segunda.modo).toBe('ja-era-repositorio');
    expect(segunda.caminho).toBe(primeira.caminho);
  });
});

describe('criarPastaDoProjeto — as recusas, e todas NOMEADAS', () => {
  it('sem base consentida: `sem-base`, e nada é criado', async () => {
    const git = vi.fn(async () => undefined);

    const erro = await criarPastaDoProjeto({
      base: null,
      segmento: 'loja',
      rodarGit: git,
    }).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(CriacaoDePastaRecusadaError);
    expect((erro as CriacaoDePastaRecusadaError).motivo).toBe('sem-base');
    expect(git).not.toHaveBeenCalled();
  });

  it('segmento ABSOLUTO é recusado por léxico — nunca aceito e reinterpretado', async () => {
    const base = join(raiz, 'projetos');
    mkdirSync(base);

    const erro = await criarPastaDoProjeto({
      base,
      segmento: '/etc',
      rodarGit: vi.fn(async () => undefined),
    }).catch((e: unknown) => e);

    expect((erro as CriacaoDePastaRecusadaError).motivo).toBe('segmento');
  });

  it('segmento com `..` que escapa da base é recusado, e a pasta NÃO nasce', async () => {
    const base = join(raiz, 'projetos');
    mkdirSync(base);

    const erro = await criarPastaDoProjeto({
      base,
      segmento: '../fora',
      rodarGit: vi.fn(async () => undefined),
    }).catch((e: unknown) => e);

    expect((erro as CriacaoDePastaRecusadaError).motivo).toBe('segmento');
    expect(existsSync(join(raiz, 'fora'))).toBe(false);
  });

  it('alvo que já existe e é ARQUIVO: `nao-e-pasta` — nunca sobrescrito', async () => {
    const base = join(raiz, 'projetos');
    mkdirSync(base);
    writeFileSync(join(base, 'loja'), 'nao sou pasta');

    const erro = await criarPastaDoProjeto({
      base,
      segmento: 'loja',
      rodarGit: vi.fn(async () => undefined),
    }).catch((e: unknown) => e);

    expect((erro as CriacaoDePastaRecusadaError).motivo).toBe('nao-e-pasta');
  });

  it('git que falha vira `git` NOMEADO, nunca um plano B silencioso', async () => {
    const base = join(raiz, 'projetos');
    mkdirSync(base);

    const erro = await criarPastaDoProjeto({
      base,
      segmento: 'loja',
      rodarGit: vi.fn(async () => {
        throw new Error('fatal: repositório não encontrado');
      }),
    }).catch((e: unknown) => e);

    expect((erro as CriacaoDePastaRecusadaError).motivo).toBe('git');
    expect((erro as Error).message).toContain('fatal: repositório não encontrado');
    // A pasta FICA — dizer que ela não existe seria mentir sobre o disco.
    expect(existsSync(join(base, 'loja'))).toBe(true);
  });

  it('cada motivo tem texto próprio — nenhum se disfarça de outro', async () => {
    const base = join(raiz, 'projetos');
    mkdirSync(base);
    writeFileSync(join(base, 'arquivo'), 'x');

    const motivos = await Promise.all(
      [
        criarPastaDoProjeto({ base: null, segmento: 'loja' }),
        criarPastaDoProjeto({ base, segmento: '/etc' }),
        criarPastaDoProjeto({ base, segmento: 'arquivo' }),
        criarPastaDoProjeto({
          base,
          segmento: 'loja',
          rodarGit: async () => {
            throw new Error('boom');
          },
        }),
      ].map((p) =>
        p.then(
          () => null,
          (e: unknown) => e as CriacaoDePastaRecusadaError,
        ),
      ),
    );

    // `null` significaria "não recusou" — e as asserções abaixo o pegariam.
    expect(motivos.map((e) => e?.motivo)).toEqual(['sem-base', 'segmento', 'nao-e-pasta', 'git']);
    expect(new Set(motivos.map((e) => e?.message)).size).toBe(4);
  });
});

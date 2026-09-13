import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DestinoDeEspelhoInvalidoError } from './espelho-guard.ts';
import {
  EspelhoSemRepositorioError,
  listarArquivosDoGit,
  sincronizarEspelho,
} from './espelho.ts';

/**
 * ADR 0147 ponto 2 / RN-516 — a cópia.
 *
 * Repositório git de VERDADE em `tmp`, nunca um fake da listagem: o que está
 * sob teste é justamente a decisão de a fonte ser a lista do git, e um fake
 * dessa lista testaria só o laço `for`.
 */
describe('sincronizarEspelho', () => {
  let raiz: string;
  let workspace: string;
  let destino: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-espelho-'));
    workspace = join(raiz, 'projeto');
    destino = join(raiz, 'meu-espelho');
    mkdirSync(workspace, { recursive: true });

    git(['init', '-q', '.']);
    git(['config', 'user.email', 't@brabo.dev']);
    git(['config', 'user.name', 't']);
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  function git(args: string[]): void {
    execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
  }

  function escrever(relativo: string, conteudo: string): void {
    const alvo = join(workspace, relativo);
    mkdirSync(join(alvo, '..'), { recursive: true });
    writeFileSync(alvo, conteudo);
  }

  it('copia RASTREADO e NÃO-RASTREADO-NÃO-IGNORADO, e cria o destino que não existia', async () => {
    escrever('src/a.ts', 'rastreado');
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);
    escrever('src/b.ts', 'novo, ainda não rastreado');

    const resultado = await sincronizarEspelho({ workspace, destino });

    expect(readFileSync(join(destino, 'src/a.ts'), 'utf8')).toBe('rastreado');
    expect(readFileSync(join(destino, 'src/b.ts'), 'utf8')).toBe('novo, ainda não rastreado');
    expect(resultado.copiados).toBe(2);
    expect(resultado.recusados).toBe(0);
  });

  it('NÃO copia o que o .gitignore ignora, nem o `.git` — sem lista de exclusão própria', async () => {
    escrever('.gitignore', 'node_modules/\ndist/\n');
    escrever('node_modules/pacote/index.js', 'dependência');
    escrever('dist/bundle.js', 'saída de build');
    escrever('app.ts', 'o trabalho');
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);

    await sincronizarEspelho({ workspace, destino });

    expect(existsSync(join(destino, 'app.ts'))).toBe(true);
    expect(existsSync(join(destino, '.gitignore'))).toBe(true);
    expect(existsSync(join(destino, 'node_modules'))).toBe(false);
    expect(existsSync(join(destino, 'dist'))).toBe(false);
    expect(existsSync(join(destino, '.git'))).toBe(false);
  });

  /**
   * O teste que prova a decisão do ADR: **uma direção, nunca apaga**. A pasta
   * do usuário é acúmulo, não réplica — e um agente que apaga arquivo na
   * pasta pessoal de alguém por causa de um `git rm` do outro lado é a
   * surpresa que o produto existe para não produzir.
   */
  it('arquivo APAGADO na origem PERMANECE no destino — nunca `--delete`, nunca `unlink`', async () => {
    escrever('some.ts', 'vou sumir da origem');
    escrever('fica.ts', 'v1');
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);

    await sincronizarEspelho({ workspace, destino });
    expect(existsSync(join(destino, 'some.ts'))).toBe(true);

    git(['rm', '-q', 'some.ts']);
    escrever('fica.ts', 'v2');

    const segunda = await sincronizarEspelho({ workspace, destino });

    // Sumiu da origem e da lista do git...
    expect(existsSync(join(workspace, 'some.ts'))).toBe(false);
    // ...e continua no destino, para sempre.
    expect(readFileSync(join(destino, 'some.ts'), 'utf8')).toBe('vou sumir da origem');
    // E o que MUDOU foi sobrescrito — isso sim é esperado.
    expect(readFileSync(join(destino, 'fica.ts'), 'utf8')).toBe('v2');
    expect(segunda.copiados).toBe(1);
  });

  it('repositório git ANINHADO (o worktree de um dev agent) vira UMA entrada de diretório, e é pulado', async () => {
    escrever('app.ts', 'o trabalho');
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);

    // Mesmo lugar que `Engine.Dev.WorktreeManager` usa.
    const worktree = join(workspace, '.worktrees', 'dev-api');
    mkdirSync(worktree, { recursive: true });
    execFileSync('git', ['init', '-q', '.'], { cwd: worktree, stdio: 'pipe' });
    writeFileSync(join(worktree, 'isolado.ts'), 'trabalho ainda no worktree');

    const resultado = await sincronizarEspelho({ workspace, destino });

    expect(existsSync(join(destino, 'app.ts'))).toBe(true);
    expect(existsSync(join(destino, '.worktrees/dev-api/isolado.ts'))).toBe(false);
    expect(resultado.pulados).toBeGreaterThanOrEqual(1);
  });

  it('symlink RASTREADO na origem é pulado — copiar o alvo traria conteúdo de fora do projeto', async () => {
    const fora = join(raiz, 'segredos');
    mkdirSync(fora, { recursive: true });
    writeFileSync(join(fora, 'chave.txt'), 'nunca deveria sair daqui');

    escrever('app.ts', 'o trabalho');
    symlinkSync(join(fora, 'chave.txt'), join(workspace, 'atalho.txt'));
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);

    const resultado = await sincronizarEspelho({ workspace, destino });

    expect(existsSync(join(destino, 'app.ts'))).toBe(true);
    expect(existsSync(join(destino, 'atalho.txt'))).toBe(false);
    expect(resultado.pulados).toBe(1);
  });

  it('symlink no DESTINO apontando para fora: o alvo é recusado, e nada é escrito lá', async () => {
    const fora = join(raiz, 'fora');
    mkdirSync(fora, { recursive: true });
    mkdirSync(destino, { recursive: true });
    symlinkSync(fora, join(destino, 'src'), 'dir');

    escrever('src/a.ts', 'o trabalho');
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);

    const resultado = await sincronizarEspelho({ workspace, destino });

    expect(resultado.recusados).toBe(1);
    expect(resultado.copiados).toBe(0);
    expect(existsSync(join(fora, 'a.ts'))).toBe(false);
  });

  it('a GUARDA roda antes de qualquer `mkdir`: destino dentro do projeto é recusado e nada é criado', async () => {
    escrever('app.ts', 'x');
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);

    const dentro = join(workspace, 'espelho');
    await expect(sincronizarEspelho({ workspace, destino: dentro })).rejects.toBeInstanceOf(
      DestinoDeEspelhoInvalidoError,
    );
    expect(existsSync(dentro)).toBe(false);
  });

  it('pasta que NÃO é repositório git falha com motivo NOMEADO — nunca cai num `cp -r` de tudo', async () => {
    const semGit = join(raiz, 'sem-git');
    mkdirSync(join(semGit, 'node_modules'), { recursive: true });
    writeFileSync(join(semGit, 'node_modules', 'gigante.js'), 'x');

    const erro = await sincronizarEspelho({ workspace: semGit, destino }).catch(
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(EspelhoSemRepositorioError);
    expect((erro as Error).message).toContain('LISTA DO GIT');
    // Plano B nenhum: nada foi copiado.
    expect(existsSync(join(destino, 'node_modules'))).toBe(false);
  });

  it('pasta INEXISTENTE falha com o mesmo motivo nomeado', async () => {
    await expect(
      sincronizarEspelho({ workspace: join(raiz, 'nao-existe'), destino }),
    ).rejects.toBeInstanceOf(EspelhoSemRepositorioError);
  });

  it('listarArquivosDoGit devolve rastreados + não-ignorados, deduplicado e ordenado', async () => {
    escrever('.gitignore', 'ignorado.txt\n');
    escrever('b.ts', 'b');
    escrever('a.ts', 'a');
    escrever('ignorado.txt', 'some');
    git(['add', '.gitignore', 'a.ts']);
    git(['commit', '-qm', 'inicial']);

    expect(await listarArquivosDoGit(workspace)).toEqual(['.gitignore', 'a.ts', 'b.ts']);
  });
});

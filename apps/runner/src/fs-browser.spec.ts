import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diretorioInicial, listarDiretorio } from './fs-browser.ts';

describe('fs-browser', () => {
  let raiz: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'brabo-runner-fs-browser-'));
  });

  afterEach(async () => {
    // Restaura permissão antes de apagar — um diretório 0o000 não deixa nem
    // o próprio `rm -rf` entrar nele.
    await chmod(raiz, 0o755).catch(() => {});
    await rm(raiz, { recursive: true, force: true });
  });

  it('lista pastas ANTES de arquivos, e depois em ordem alfabética', async () => {
    await mkdir(join(raiz, 'zzz-pasta'));
    await mkdir(join(raiz, 'aaa-pasta'));
    await writeFile(join(raiz, 'arquivo.txt'), 'oi');
    await writeFile(join(raiz, 'bbb-arquivo.txt'), 'oi');

    const resultado = await listarDiretorio(raiz);

    expect(resultado.erro).toBeUndefined();
    expect(resultado.path).toBe(raiz);
    expect(resultado.entradas).toEqual([
      { nome: 'aaa-pasta', isDir: true },
      { nome: 'zzz-pasta', isDir: true },
      { nome: 'arquivo.txt', isDir: false },
      { nome: 'bbb-arquivo.txt', isDir: false },
    ]);
  });

  it('pasta vazia devolve lista vazia sem erro', async () => {
    const resultado = await listarDiretorio(raiz);
    expect(resultado.erro).toBeUndefined();
    expect(resultado.entradas).toEqual([]);
  });

  it('caminho inexistente devolve erro explícito, nunca lança', async () => {
    const resultado = await listarDiretorio(join(raiz, 'nao-existe'));
    expect(resultado.entradas).toEqual([]);
    expect(resultado.erro).toBeDefined();
  });

  it('caminho que é um ARQUIVO (não pasta) devolve erro explícito, nunca lança', async () => {
    const arquivo = join(raiz, 'sou-um-arquivo.txt');
    await writeFile(arquivo, 'oi');

    const resultado = await listarDiretorio(arquivo);
    expect(resultado.entradas).toEqual([]);
    expect(resultado.erro).toBeDefined();
  });

  it('normaliza o caminho (resolve `..`/barra dupla) antes de listar', async () => {
    await mkdir(join(raiz, 'sub'));
    const comBarraDupla = `${raiz}//sub/..`;

    const resultado = await listarDiretorio(comBarraDupla);
    expect(resultado.erro).toBeUndefined();
    expect(resultado.path).toBe(raiz);
  });

  it('diretorioInicial() devolve uma string não vazia (os.homedir())', () => {
    expect(typeof diretorioInicial()).toBe('string');
    expect(diretorioInicial().length).toBeGreaterThan(0);
  });

  // Roda só quando o processo NÃO é root (root ignora bits de permissão) —
  // mesmo cuidado que qualquer teste de ACL precisa em CI.
  const rodandoComoRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(rodandoComoRoot)(
    'pasta sem permissão de leitura vira erro na PRÓPRIA listagem, sem lançar',
    async () => {
      const semPermissao = join(raiz, 'trancada');
      await mkdir(semPermissao);
      await chmod(semPermissao, 0o000);

      const resultado = await listarDiretorio(semPermissao);
      expect(resultado.entradas).toEqual([]);
      expect(resultado.erro).toBeDefined();

      await chmod(semPermissao, 0o755);
    },
  );
});

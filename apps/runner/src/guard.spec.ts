import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CwdForaDaRaizError, validarCwdDentroDaRaiz } from './guard.ts';

describe('validarCwdDentroDaRaiz', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-runner-guard-'));
    mkdirSync(join(raiz, 'sub'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('aceita a própria raiz', () => {
    expect(validarCwdDentroDaRaiz(raiz, raiz)).toBe(raiz);
  });

  it('aceita um caminho dentro da raiz', () => {
    const alvo = join(raiz, 'sub');
    expect(validarCwdDentroDaRaiz(alvo, raiz)).toBe(alvo);
  });

  it('recusa caminho com ".." tentando escapar', () => {
    const alvo = join(raiz, '..', 'etc');
    expect(() => validarCwdDentroDaRaiz(alvo, raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa caminho absoluto fora da raiz', () => {
    expect(() => validarCwdDentroDaRaiz('/etc', raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa caminho relativo', () => {
    expect(() => validarCwdDentroDaRaiz('sub', raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa caminho vazio', () => {
    expect(() => validarCwdDentroDaRaiz('', raiz)).toThrow(CwdForaDaRaizError);
  });

  it('recusa symlink dentro da raiz que aponta para fora dela', () => {
    const fora = mkdtempSync(join(tmpdir(), 'brabo-runner-fora-'));
    const link = join(raiz, 'escape');
    symlinkSync(fora, link);

    try {
      expect(() => validarCwdDentroDaRaiz(link, raiz)).toThrow(CwdForaDaRaizError);
    } finally {
      rmSync(fora, { recursive: true, force: true });
    }
  });
});

import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { garantirSpawnHelperExecutavel, type DiscoDoSpawnHelper } from './spawn-helper.ts';

// AT-114: o defeito só existe no macOS, e aqui não há macOS. O que se simula é
// a PLATAFORMA (parâmetro) e o LAYOUT do tarball do node-pty@1.1.0
// (`prebuilds/darwin-<arch>/{pty.node,spawn-helper}`, o helper em 0644 —
// medido no pacote instalado). O chmod é o de verdade, sobre arquivo real;
// só a recusa de permissão é injetada.

function pacoteFalso(montar: (raiz: string) => void): string {
  const raiz = mkdtempSync(join(tmpdir(), 'node-pty-spawn-helper-'));
  montar(raiz);
  return raiz;
}

function criar(caminho: string, modo = 0o644): void {
  mkdirSync(join(caminho, '..'), { recursive: true });
  writeFileSync(caminho, 'x');
  chmodSync(caminho, modo);
}

const modoDe = (caminho: string) => statSync(caminho).mode & 0o777;

describe('garantirSpawnHelperExecutavel (AT-114)', () => {
  it('no macOS, dá o bit de execução ao spawn-helper do prebuild que chegou 0644', () => {
    const raiz = pacoteFalso((r) => {
      criar(join(r, 'prebuilds', 'darwin-x64', 'pty.node'));
      criar(join(r, 'prebuilds', 'darwin-x64', 'spawn-helper'), 0o644);
    });
    const helper = join(raiz, 'prebuilds', 'darwin-x64', 'spawn-helper');

    const desfecho = garantirSpawnHelperExecutavel({ raizDoNodePty: raiz, plataforma: 'darwin', arch: 'x64' });

    expect(desfecho).toEqual({ tipo: 'corrigido', caminho: helper });
    expect(modoDe(helper)).toBe(0o755);
  });

  it('é idempotente: a segunda chamada não toca o arquivo', () => {
    const raiz = pacoteFalso((r) => {
      criar(join(r, 'prebuilds', 'darwin-arm64', 'pty.node'));
      criar(join(r, 'prebuilds', 'darwin-arm64', 'spawn-helper'), 0o644);
    });
    const opcoes = { raizDoNodePty: raiz, plataforma: 'darwin' as const, arch: 'arm64' };
    expect(garantirSpawnHelperExecutavel(opcoes).tipo).toBe('corrigido');

    const chamadas: string[] = [];
    const disco: DiscoDoSpawnHelper = {
      existe: (c) => existsSync(c),
      modo: (c) => statSync(c).mode,
      chmod: (c) => chamadas.push(c),
    };
    expect(garantirSpawnHelperExecutavel({ ...opcoes, disco }).tipo).toBe('ja-executavel');
    expect(chamadas).toEqual([]);
  });

  it('segue a ordem do node-pty: build/Release vence o prebuild', () => {
    const raiz = pacoteFalso((r) => {
      criar(join(r, 'build', 'Release', 'pty.node'));
      criar(join(r, 'build', 'Release', 'spawn-helper'), 0o644);
      criar(join(r, 'prebuilds', 'darwin-arm64', 'pty.node'));
      criar(join(r, 'prebuilds', 'darwin-arm64', 'spawn-helper'), 0o644);
    });
    const desfecho = garantirSpawnHelperExecutavel({ raizDoNodePty: raiz, plataforma: 'darwin', arch: 'arm64' });
    expect(desfecho).toEqual({ tipo: 'corrigido', caminho: join(raiz, 'build', 'Release', 'spawn-helper') });
    expect(modoDe(join(raiz, 'prebuilds', 'darwin-arm64', 'spawn-helper'))).toBe(0o644);
  });

  it('fora do macOS não toca o disco', () => {
    const disco: DiscoDoSpawnHelper = {
      existe: () => {
        throw new Error('não devia olhar o disco');
      },
      modo: () => 0,
      chmod: () => {
        throw new Error('não devia dar chmod');
      },
    };
    for (const plataforma of ['linux', 'win32'] as const) {
      expect(garantirSpawnHelperExecutavel({ raizDoNodePty: '/x', plataforma, arch: 'x64', disco })).toEqual({
        tipo: 'nao-se-aplica',
        plataforma,
      });
    }
  });

  it('falha NOMEADA quando o spawn-helper não existe ao lado do pty.node', () => {
    const raiz = pacoteFalso((r) => criar(join(r, 'prebuilds', 'darwin-x64', 'pty.node')));
    expect(() =>
      garantirSpawnHelperExecutavel({ raizDoNodePty: raiz, plataforma: 'darwin', arch: 'x64' }),
    ).toThrow(new RegExp(`${join(raiz, 'prebuilds', 'darwin-x64', 'spawn-helper')} não existe`));
  });

  it('falha NOMEADA quando não há pty.node em pasta nenhuma', () => {
    const raiz = pacoteFalso(() => {});
    expect(() =>
      garantirSpawnHelperExecutavel({ raizDoNodePty: raiz, plataforma: 'darwin', arch: 'arm64' }),
    ).toThrow(/nenhum pty\.node do node-pty para darwin-arm64/);
  });

  it('quando o chmod é recusado (instalação global de outro dono), diz o comando do conserto', () => {
    const raiz = pacoteFalso((r) => {
      criar(join(r, 'prebuilds', 'darwin-x64', 'pty.node'));
      criar(join(r, 'prebuilds', 'darwin-x64', 'spawn-helper'), 0o644);
    });
    const helper = join(raiz, 'prebuilds', 'darwin-x64', 'spawn-helper');
    const disco: DiscoDoSpawnHelper = {
      existe: (c) => existsSync(c),
      modo: () => 0o100644,
      chmod: () => {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      },
    };
    let mensagem = '';
    try {
      garantirSpawnHelperExecutavel({ raizDoNodePty: raiz, plataforma: 'darwin', arch: 'x64', disco });
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toContain('EPERM');
    expect(mensagem).toContain(`chmod +x "${helper}"`);
    expect(modoDe(helper)).toBe(0o644);
  });
});

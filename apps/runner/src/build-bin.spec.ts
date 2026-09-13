import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — `build-bin.mjs` é JS puro (roda por `node` antes de
// qualquer build), e o que se testa aqui é a DECISÃO de onde estão os
// arquivos nativos, idêntica dos dois lados.
import { localizarArquivosNativos } from '../scripts/build-bin.mjs';

interface ArquivoNativo {
  abs: string;
  rel: string;
  exec: boolean;
}

// Os DOIS defeitos que este arquivo existe para não deixar voltar reprovaram a
// matriz de binários em TODA tag, e nenhum deles aparece no Linux — que é a
// única plataforma onde `pnpm --filter runner build:bin` roda antes do CI.
// Por isso os layouts são FABRICADOS aqui: é o que torna a correção
// verificável sem um macOS e um Windows à mão.

function pacoteFalso(montar: (raiz: string) => void): string {
  const raiz = mkdtempSync(join(tmpdir(), 'node-pty-falso-'));
  montar(raiz);
  return raiz;
}

const criar = (caminho: string, conteudo = 'x') => {
  mkdirSync(join(caminho, '..'), { recursive: true });
  writeFileSync(caminho, conteudo);
};

describe('build-bin — onde estão os arquivos nativos', () => {
  // O layout do Linux: node-gyp compilou, e `build/Release` tem o binding.
  it('usa build/Release quando ele tem o .node', () => {
    const raiz = pacoteFalso((r: string) => {
      mkdirSync(join(r, 'build', 'Release'), { recursive: true });
      criar(join(r, 'build', 'Release', 'pty.node'));
    });
    const achados: ArquivoNativo[] = localizarArquivosNativos(raiz);
    expect(achados.map((a: ArquivoNativo) => a.rel)).toContain(join('build', 'Release', 'pty.node'));
  });

  // O layout do WINDOWS, e o defeito que travava `win32-x64` em toda tag:
  // `post-install.js` do node-pty limpa `build/Release` e move o `conpty/`
  // para lá, enquanto os `.node` vêm do prebuild. A pasta EXISTE e não tem
  // `.node` — escolher pelo primeiro que existe reprovava com "existe mas não
  // tem nenhum .node dentro".
  it('cai no prebuild quando build/Release existe SEM .node', () => {
    const raiz = pacoteFalso((r: string) => {
      mkdirSync(join(r, 'build', 'Release', 'conpty'), { recursive: true });
      criar(join(r, 'build', 'Release', 'conpty', 'conpty.dll'));
      mkdirSync(join(r, 'prebuilds', `${process.platform}-${process.arch}`), { recursive: true });
      criar(join(r, 'prebuilds', `${process.platform}-${process.arch}`, 'pty.node'));
    });
    const achados: ArquivoNativo[] = localizarArquivosNativos(raiz);
    expect(achados.some((a: ArquivoNativo) => a.abs.includes('prebuilds'))).toBe(true);
    expect(achados.some((a: ArquivoNativo) => a.abs.includes(join('build', 'Release')))).toBe(false);
  });

  // O layout do macOS, e o defeito que travava `darwin-arm64`: o
  // `spawn-helper` fica ao lado do binding e é EXECUTADO pelo C++ do
  // node-pty. Embutindo só `*.node`, o PTY não abre — `posix_spawnp failed`.
  it('embute o spawn-helper, e o marca como executável', () => {
    const raiz = pacoteFalso((r: string) => {
      mkdirSync(join(r, 'build', 'Release'), { recursive: true });
      criar(join(r, 'build', 'Release', 'pty.node'));
      criar(join(r, 'build', 'Release', 'spawn-helper'));
    });
    const achados: ArquivoNativo[] = localizarArquivosNativos(raiz);
    const helper = achados.find((a: ArquivoNativo) => a.rel.endsWith('spawn-helper'));
    expect(helper).toBeDefined();
    expect(helper?.exec).toBe(true);
    // O binding NÃO é executável — o bit é do que se spawna, não do que se
    // carrega com `require`.
    expect(achados.find((a: ArquivoNativo) => a.rel.endsWith('pty.node'))?.exec).toBe(false);
  });

  it('marca .exe como executável e ignora .pdb', () => {
    const raiz = pacoteFalso((r: string) => {
      mkdirSync(join(r, 'build', 'Release'), { recursive: true });
      criar(join(r, 'build', 'Release', 'pty.node'));
      criar(join(r, 'build', 'Release', 'winpty-agent.exe'));
      criar(join(r, 'build', 'Release', 'pty.pdb'));
    });
    const achados: ArquivoNativo[] = localizarArquivosNativos(raiz);
    expect(achados.find((a: ArquivoNativo) => a.rel.endsWith('winpty-agent.exe'))?.exec).toBe(true);
    expect(achados.some((a: ArquivoNativo) => a.rel.endsWith('.pdb'))).toBe(false);
  });

  it('desce em subpasta — o conpty/ do Windows entra inteiro', () => {
    const raiz = pacoteFalso((r: string) => {
      mkdirSync(join(r, 'build', 'Release', 'conpty'), { recursive: true });
      criar(join(r, 'build', 'Release', 'pty.node'));
      criar(join(r, 'build', 'Release', 'conpty', 'OpenConsole.exe'));
    });
    const achados: ArquivoNativo[] = localizarArquivosNativos(raiz);
    expect(achados.some((a: ArquivoNativo) => a.rel.endsWith(join('conpty', 'OpenConsole.exe')))).toBe(true);
  });

  it('recusa nomeando os dois caminhos quando não há .node em lugar nenhum', () => {
    const raiz = pacoteFalso((r: string) => mkdirSync(join(r, 'build', 'Release'), { recursive: true }));
    expect(() => localizarArquivosNativos(raiz)).toThrow(/nenhum \.node nativo encontrado/);
  });
});

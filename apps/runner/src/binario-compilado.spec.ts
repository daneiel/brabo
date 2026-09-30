import { describe, expect, it } from 'vitest';
import { ehCaminhoDoBinarioCompilado } from './binario-compilado.ts';

describe('ehCaminhoDoBinarioCompilado (AT-343)', () => {
  it('reconhece o prefixo virtual de Linux/macOS, como URL e como caminho', () => {
    expect(ehCaminhoDoBinarioCompilado('file:///$bunfs/root/brabo-runner-linux-x64')).toBe(true);
    expect(ehCaminhoDoBinarioCompilado('/$bunfs/root/brabo-runner-darwin-arm64')).toBe(true);
  });

  it('reconhece o prefixo virtual do Windows — URL, barra e contrabarra', () => {
    expect(
      ehCaminhoDoBinarioCompilado('file:///B:/~BUN/root/brabo-runner-win32-x64.exe'),
    ).toBe(true);
    expect(ehCaminhoDoBinarioCompilado('B:/~BUN/root/brabo-runner-win32-x64.exe')).toBe(true);
    expect(ehCaminhoDoBinarioCompilado('B:\\~BUN\\root\\brabo-runner-win32-x64.exe')).toBe(true);
  });

  it('não confunde caminho real de disco, nem pasta cujo nome só CONTÉM ~BUN', () => {
    expect(ehCaminhoDoBinarioCompilado('file:///home/ana/brabo/apps/runner/src/index.ts')).toBe(false);
    expect(ehCaminhoDoBinarioCompilado('C:\\Users\\ana\\x~BUN\\root\\index.cjs')).toBe(false);
    expect(ehCaminhoDoBinarioCompilado('C:\\Users\\ana\\~BUNDLE\\root\\index.cjs')).toBe(false);
    expect(ehCaminhoDoBinarioCompilado('')).toBe(false);
    expect(ehCaminhoDoBinarioCompilado(undefined)).toBe(false);
  });
});

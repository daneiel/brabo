import { describe, expect, it } from 'vitest';
import { ler } from '../docs/fontes.mjs';

/**
 * A versão do semgrep nas DUAS imagens do engine.
 *
 * Por que este teste existe: o `docker/engine/Dockerfile` (dev) instalava
 * `semgrep` sem versão, e o rebuild de 02/10 pegou a 1.179.0 — a primeira que
 * NÃO publica wheel `musllinux`. No Alpine o pip montou o pacote do sdist, sem
 * o `semgrep-core`, e todo scan saiu com exit 2: o gate SecOps de dev ficou
 * pendente (RN-714) por um defeito da IMAGEM, não da PR. O `Dockerfile.prod`
 * já fixava a 1.171.0. A régua é a mesma versão nos dois lados, e subir a
 * versão é escolher uma que tenha wheel musllinux no PyPI.
 */

function versaoDoArg(caminho: string): string | undefined {
  return ler(caminho).match(/^ARG SEMGREP_VERSION=(\S+)$/m)?.[1];
}

describe('semgrep do engine', () => {
  it('o Dockerfile de dev fixa a versão e a usa no pip install', () => {
    const dev = ler('docker/engine/Dockerfile');
    expect(versaoDoArg('docker/engine/Dockerfile')).toBeDefined();
    expect(dev).toContain('"semgrep==${SEMGREP_VERSION}"');
    expect(dev).not.toMatch(/--break-system-packages semgrep(\s|\\|$)/);
  });

  it('dev e produção instalam a MESMA versão', () => {
    const prod = versaoDoArg('docker/engine/Dockerfile.prod');
    expect(prod).toBeDefined();
    expect(versaoDoArg('docker/engine/Dockerfile')).toBe(prod);
  });
});

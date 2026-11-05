import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { arquivos, caminhoReal, CAMINHO_FONTES, fonteDe, ler, lerMapaDeFontes } from './fontes.mjs';

const mapaTemporario = (corpo: string) => {
  const arq = join(mkdtempSync(join(tmpdir(), 'fontes-')), 'fontes.yml');
  writeFileSync(arq, corpo);
  process.env.BRABO_FONTES = arq;
};

afterEach(() => {
  delete process.env.BRABO_FONTES;
});

describe('fontes.yml', () => {
  it('no monorepo o mapa é identidade: o caminho resolvido não muda', () => {
    expect(caminhoReal('apps/api/src/main.ts')).toMatch(/\/apps\/api\/src\/main\.ts$/);
    expect(ler('Makefile').length).toBeGreaterThan(0);
    expect(arquivos('apps/api/src/*.ts').length).toBeGreaterThan(0);
    expect(arquivos('apps/api/src/*.ts')[0]).toMatch(/^apps\/api\/src\//);
  });

  it('prefixo mais longo vence e o resto cai em infra', () => {
    expect(fonteDe('apps/api/src/main.ts').nome).toBe('api');
    expect(fonteDe('packages/shared/src/index.ts').nome).toBe('contracts');
    expect(fonteDe('docker/docker-compose.yml').nome).toBe('infra');
  });

  // MUTAÇÃO: raiz errada reprova nomeando a fonte, nunca cai no caminho antigo.
  it('raiz errada reprova nomeando a fonte', () => {
    const canon = lerMapaDeFontes(CAMINHO_FONTES);
    mapaTemporario(
      Object.entries({ ...canon, api: 'apps/nao-existe' })
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
    );
    expect(() => ler('apps/api/src/main.ts')).toThrow(/fonte "api"/);
    expect(() => arquivos('apps/api/src/*.ts')).toThrow(/fonte "api"/);
  });

  it('nome inexistente no mapa ativo lança com o nome', () => {
    mapaTemporario('web: apps/web\ninfra: .\n');
    expect(() => caminhoReal('apps/engine/mix.exs')).toThrow(/fonte "engine"/);
  });
});

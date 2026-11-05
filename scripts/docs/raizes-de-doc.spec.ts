import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lerRaizesDeDoc, RAIZES_DE_DOC } from './raizes-de-doc.mjs';
import { fonteDe } from './fontes.mjs';

afterEach(() => {
  delete process.env.BRABO_FONTES;
});

describe('raízes de doc (AT-693)', () => {
  it('toda raiz de doc é coberta por uma fonte do fontes.yml', () => {
    for (const raiz of Object.values(RAIZES_DE_DOC)) expect(() => fonteDe(raiz)).not.toThrow();
  });

  it('o agregador vem primeiro e só raízes existentes entram', () => {
    const raizes = lerRaizesDeDoc();
    expect(raizes[0]).toMatchObject({ nome: 'produto', raiz: 'docs' });
    expect(raizes.every((r) => r.dir.endsWith(r.raiz))).toBe(true);
  });

  it('mutação: sem o agregador no mapa ativo, reprova em vez de devolver vazio', () => {
    const arq = join(mkdtempSync(join(tmpdir(), 'raizes-')), 'fontes.yml');
    writeFileSync(arq, 'api: apps/api\nengine: apps/engine\nweb: apps/web\nrunner: apps/runner\nbroker: apps/broker\ncontracts: packages\ndocs: /nao/existe\ninfra: .\n');
    process.env.BRABO_FONTES = arq;
    expect(() => lerRaizesDeDoc()).toThrow(/produto/);
  });
});

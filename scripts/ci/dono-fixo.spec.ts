import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guarda da AT-691 (EP-033): o dono do repositório (`daneiel`) não fica escrito
 * no código, no instalador nem no CI. Exceções declaradas: comentário, o PADRÃO
 * de uma variável (`?? 'daneiel/brabo'`, `:-daneiel/brabo`) e o Ko-fi pessoal.
 * Fora do escopo por desenho: CHANGELOG, ADRs, histórico, fixtures de spec,
 * `.release/images.json` e overlays (gerados), templates, FUNDING e CODEOWNERS.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARQUIVOS = [
  'install.sh',
  'apps/api/src/interfaces/http/runner/runner-releases.controller.ts',
  'apps/runner/src/servico.ts',
  'website/docusaurus.config.ts',
  'website/sidebars.ts',
  '.github/workflows/docs-deploy.yml',
  'docker-bake.hcl',
];
const PERMITIDA = /^\s*(#|\/\/|\*|\/\*)|\?\? 'daneiel\/brabo'|:-daneiel\/brabo|ko-fi\.com\/daneiel/;

function violacoes(texto: string): string[] {
  return texto.split('\n').filter((l) => /daneiel/.test(l) && !PERMITIDA.test(l));
}

describe('dono fixo fora do código (AT-691)', () => {
  for (const arq of ARQUIVOS) {
    it(`${arq} não escreve o dono`, () => {
      expect(violacoes(readFileSync(path.join(RAIZ, arq), 'utf8'))).toEqual([]);
    });
  }
  it('reprova o dono fixo (caso de falha)', () => {
    expect(violacoes("const u = 'https://github.com/daneiel/brabo';")).toHaveLength(1);
  });
});

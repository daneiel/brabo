import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guarda da AT-691 (EP-033): o dono do repositório (`daneiel`) não fica escrito
 * no código, no instalador nem no CI. Varre TODO arquivo versionado
 * (`git ls-files`); o que escapa é lista NOMEADA, com o motivo. Também passam
 * as linhas de comentário, o PADRÃO de uma variável (`?? 'daneiel/brabo'`,
 * `:-daneiel/brabo`, `|| 'daneiel/brabo'`) e o Ko-fi pessoal.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXCECOES: ReadonlyArray<[RegExp, string]> = [
  [/\.md$|^(docs|apps\/[^/]+\/docs|packages\/docs|deploy\/docs|scripts\/ci\/docs)\/|^website\/i18n\//, 'prosa, CHANGELOG, ADRs e histórico'],
  [/^\.github\/(FUNDING\.yml|ISSUE_TEMPLATE\/)|^CODEOWNERS$/, 'identidade e templates de comunidade'],
  [/^apps\/runner\/package\.json$/, 'metadado do npm'],
  [/^\.release\/images\.json$|^deploy\/k8s\/overlays\//, 'gerados por aplicar-imagens'],
  [/dto\/.*\.dto\.ts$|api-types\.generated\.ts$/, 'exemplos de DTO e tipos gerados do openapi'],
  [/\.(spec|test)\.(ts|tsx|mjs)$|_test\.exs$|\/test\/support\//, 'fixtures de teste'],
];
const PERMITIDA =
  /^\s*(#|\/\/|\*|\/\*)|(\?\?|\|\|) 'daneiel\/brabo'|:-daneiel\/brabo|ko-fi\.com\/daneiel/;

function violacoes(texto: string): string[] {
  return texto.split('\n').filter((l) => /daneiel/.test(l) && !PERMITIDA.test(l));
}

describe('dono fixo fora do código (AT-691)', () => {
  it('nenhum arquivo versionado escreve o dono, salvo as exceções nomeadas', () => {
    const arquivos = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f && !EXCECOES.some(([re]) => re.test(f)));
    expect(arquivos.length).toBeGreaterThan(500);
    const achados: string[] = [];
    for (const f of arquivos) {
      let texto: string;
      try {
        texto = readFileSync(path.join(RAIZ, f), 'utf8');
      } catch {
        continue;
      }
      for (const l of violacoes(texto)) achados.push(`${f}: ${l.trim().slice(0, 100)}`);
    }
    expect(achados).toEqual([]);
  });
  it('reprova o dono fixo (caso de falha)', () => {
    expect(violacoes("const u = 'https://github.com/daneiel/brabo';")).toHaveLength(1);
    expect(violacoes("const u = process.env.X ?? 'daneiel/brabo';")).toHaveLength(0);
  });
});

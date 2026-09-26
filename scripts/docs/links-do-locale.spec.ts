import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acharLocaleDuplicado,
  hrefsComLocaleDuplicado,
  reescreverLinkDeGap,
} from './links-do-locale.mjs';

// AT-221: a reescrita punha `/pt-BR` e o baseUrl do locale punha de novo —
// `href=/brabo/prd/pt-BR/pt-BR/...`, 404 no site pt-BR inteiro, build verde.
const FONTE_PT = 'i18n/pt-BR/docusaurus-plugin-content-docs/current/business-rules.md';

describe('reescreverLinkDeGap', () => {
  it('não põe prefixo de locale: quem põe é o baseUrl do build', () => {
    const rota = reescreverLinkDeGap({
      sourceFilePath: FONTE_PT,
      url: 'adr/0104-runner-local.md#decisao',
    });
    expect(rota).toBe('pathname:///adr/0104-runner-local#decisao');
    expect(rota).not.toContain('pt-BR');
  });

  it('resolve o caminho relativo a partir da pasta da fonte', () => {
    expect(
      reescreverLinkDeGap({
        sourceFilePath: '../docs/reference/configuration.md',
        url: '../business-rules.md#rn-004',
      }),
    ).toBe('pathname:///business-rules#rn-004');
    expect(
      reescreverLinkDeGap({
        sourceFilePath: FONTE_PT.replace('business-rules.md', 'explanation/gates.md'),
        url: '../reference/scripts.md',
      }),
    ).toBe('pathname:///reference/scripts');
  });

  it('link quebrado fora das zonas de gap continua lançando', () => {
    expect(() =>
      reescreverLinkDeGap({ sourceFilePath: '../docs/intro.md', url: 'nao-existe.md' }),
    ).toThrow(/Markdown link quebrado/);
  });
});

describe('hrefsComLocaleDuplicado', () => {
  it('acha o href duplicado com e sem aspas (o HTML minificado não as tem)', () => {
    const html =
      '<a href=/brabo/prd/pt-BR/pt-BR/adr/0001-x>a</a> <a href="/brabo/prd/pt-BR/pt-BR/b#c">b</a>';
    expect(hrefsComLocaleDuplicado(html).sort()).toEqual([
      '/brabo/prd/pt-BR/pt-BR/adr/0001-x',
      '/brabo/prd/pt-BR/pt-BR/b#c',
    ]);
  });

  it('não acusa o prefixo simples', () => {
    expect(hrefsComLocaleDuplicado('<a href=/brabo/prd/pt-BR/adr/0001-x>a</a>')).toEqual([]);
  });
});

describe('acharLocaleDuplicado', () => {
  it('varre o build e devolve cada página ofensora', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'brabo-locale-'));
    mkdirSync(path.join(dir, 'pt-BR/adr'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<a href=/brabo/prd/adr/x>ok</a>');
    writeFileSync(
      path.join(dir, 'pt-BR/adr/0001.html'),
      '<a href=/brabo/prd/pt-BR/pt-BR/adr/0002>quebrado</a>',
    );
    const { arquivos, ofensores } = acharLocaleDuplicado(dir);
    expect(arquivos).toBe(2);
    expect([...ofensores.keys()]).toEqual([path.join('pt-BR', 'adr', '0001.html')]);
  });
});

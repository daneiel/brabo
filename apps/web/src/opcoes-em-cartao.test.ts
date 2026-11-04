import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom não tem layout: o item do kit é h-8/nowrap, e a classe do módulo é quem o libera.
const alvos: Array<[string, string]> = [
  ['routes/NewProjectWizard.module.css', 'providerOption'],
  ['routes/NewProjectWizard.module.css', 'toggleOption'],
  ['components/wizard/CredentialStep.module.css', 'credOption'],
];

describe('opções em cartão do ToggleGroup', () => {
  it.each(alvos)('%s .%s cresce e quebra linha', (arquivo, classe) => {
    const css = readFileSync(resolve(__dirname, arquivo), 'utf8');
    const bloco = css.match(new RegExp(`\\.${classe} \\{([^}]*)\\}`))?.[1] ?? '';
    expect(bloco).toMatch(/height:\s*auto/);
    expect(bloco).toMatch(/white-space:\s*normal/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Bug medido em 04/11: a âncora do menu de @/ ficava sem classe e o campo
// (textarea) saía com 179px dentro de um InputGroup de 1224px.
describe('âncora do campo do composer', () => {
  const css = readFileSync(resolve(__dirname, 'SessionPage.module.css'), 'utf8');
  const tsx = readFileSync(resolve(__dirname, 'SessionComposer.tsx'), 'utf8');

  it('a classe da âncora estica no flex e tem min-width 0', () => {
    const bloco = css.match(/\.ancoraDoCampo\s*\{([^}]*)\}/);
    expect(bloco).not.toBeNull();
    expect(bloco![1]).toMatch(/flex:\s*1\b/);
    expect(bloco![1]).toMatch(/min-width:\s*0\b/);
  // O grupo é coluna: o que estica na LARGURA é o align-self, não o flex.
  expect(bloco![1]).toMatch(/align-self:\s*stretch/);
  });

  it('o SessionComposer aplica a classe ao div da âncora', () => {
    expect(tsx).toMatch(/ref=\{setAncora\}\s*\n\s*className=\{styles\.ancoraDoCampo\}/);
  });
});

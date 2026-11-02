import { describe, expect, it } from 'vitest';
import { idiomaOriginal } from './faixa-de-traducao.mjs';

const pagina = '---\nid: configuration\nidioma_original: en\n---\n\nCorpo.\n';

describe('idiomaOriginal', () => {
  it('lê o campo do frontmatter', () => {
    expect(idiomaOriginal(pagina)).toBe('en');
  });
  it('mutação: sem o campo, a fonte é pt-BR (null)', () => {
    expect(idiomaOriginal(pagina.replace('idioma_original: en\n', ''))).toBeNull();
  });
  it('mutação: o campo no CORPO não conta', () => {
    expect(idiomaOriginal('---\nid: x\n---\n\nidioma_original: en\n')).toBeNull();
  });
});

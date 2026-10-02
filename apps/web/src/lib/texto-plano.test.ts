import { describe, expect, it } from 'vitest';
import { textoPlanoDoMarkdown } from './texto-plano';

describe('textoPlanoDoMarkdown (RN-712)', () => {
  it('tira negrito, título, régua e tabela', () => {
    const md = '## Plano\n\n**Primeiro** passo\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const plano = textoPlanoDoMarkdown(md);
    expect(plano).toBe('Plano Primeiro passo a · b 1 · 2');
    expect(plano).not.toMatch(/\*\*|##|---|\|/);
  });

  it('texto sem marcação passa intacto', () => {
    expect(textoPlanoDoMarkdown('Lendo as histórias do projeto')).toBe(
      'Lendo as histórias do projeto',
    );
  });
});

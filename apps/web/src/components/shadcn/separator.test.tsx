import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Separator } from './separator';

// jsdom não calcula layout: prova a classe que dá altura à linha horizontal (orientação do Base UI).
describe('Separator', () => {
  it('dá altura à linha horizontal pelo data-orientation que o Base UI emite', () => {
    const { container } = render(<Separator orientation="horizontal" />);
    const linha = container.querySelector('[data-slot="separator"]') as HTMLElement;
    expect(linha.getAttribute('data-orientation')).toBe('horizontal');
    expect(linha.className).toContain('data-[orientation=horizontal]:h-px');
    expect(linha.className).not.toContain('data-horizontal:');
  });
});

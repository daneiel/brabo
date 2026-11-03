import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

// jsdom não calcula layout: prova a classe que empilha os itens no grupo vertical (orientação do Base UI).
describe('ToggleGroup', () => {
  it('empilha o grupo vertical pelo data-orientation que o Base UI emite', () => {
    const { container } = render(
      <ToggleGroup orientation="vertical">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    const grupo = container.querySelector('[data-slot="toggle-group"]') as HTMLElement;
    expect(grupo.getAttribute('data-orientation')).toBe('vertical');
    expect(grupo.className).toContain('data-[orientation=vertical]:flex-col');
    expect(grupo.className).not.toContain('data-vertical:');
  });
});

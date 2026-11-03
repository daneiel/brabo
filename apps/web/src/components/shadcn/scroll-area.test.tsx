import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollArea, ScrollBar } from './scroll-area';

// jsdom não calcula layout: prova a classe que dá altura à barra horizontal (orientação do Base UI).
describe('ScrollBar', () => {
  it('dá altura à barra horizontal pelo data-orientation que o Base UI emite', () => {
    const { container } = render(
      <ScrollArea>
        <ScrollBar orientation="horizontal" keepMounted />
      </ScrollArea>,
    );
    const barra = container.querySelector('[data-slot="scroll-area-scrollbar"]') as HTMLElement;
    expect(barra.getAttribute('data-orientation')).toBe('horizontal');
    expect(barra.className).toContain('data-[orientation=horizontal]:h-2.5');
    expect(barra.className).not.toContain('data-horizontal:');
  });
});

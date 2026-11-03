import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

// jsdom não calcula layout: prova a classe que empilha lista e painel (AT-719).
describe('Tabs', () => {
  it('empilha a lista acima do painel pelo atributo que o Base UI emite', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">painel</TabsContent>
      </Tabs>,
    );
    const raiz = screen.getByRole('tablist').parentElement as HTMLElement;
    expect(raiz.getAttribute('data-orientation')).toBe('horizontal');
    expect(raiz.className).toContain('data-[orientation=horizontal]:flex-col');
    expect(raiz.className).not.toContain('data-horizontal:');
    expect(raiz.firstElementChild).toBe(screen.getByRole('tablist'));
  });
});

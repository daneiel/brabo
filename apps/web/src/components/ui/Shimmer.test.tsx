import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const reduzir = vi.hoisted(() => ({ valor: false }));
vi.mock('motion/react', async (orig) => {
  const real = await orig<typeof import('motion/react')>();
  return { ...real, useReducedMotion: () => reduzir.valor };
});

import { Shimmer } from './Shimmer';

describe('Shimmer', () => {
  beforeEach(() => {
    reduzir.valor = false;
  });

  it('renderiza o texto na tag de `as` e --spread = comprimento × spread', () => {
    render(
      <Shimmer as="p" spread={3}>
        Pensando…
      </Shimmer>,
    );
    const el = screen.getByText('Pensando…');
    expect(el.tagName).toBe('P');
    expect(el.style.getPropertyValue('--spread')).toBe(`${'Pensando…'.length * 3}px`);
  });

  it('usa span por padrão', () => {
    render(<Shimmer>abc</Shimmer>);
    expect(screen.getByText('abc').tagName).toBe('SPAN');
  });

  it('com reduced motion fica estático: sem estilo de animação nem --spread', () => {
    reduzir.valor = true;
    render(<Shimmer>parado</Shimmer>);
    const el = screen.getByText('parado');
    expect(el.getAttribute('style')).toBeNull();
  });
});

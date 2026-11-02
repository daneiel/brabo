import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('aplica largura, altura e raio no style e some para leitor de tela', () => {
    render(<Skeleton width={40} height={8} radius={3} />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveAttribute('data-slot', 'skeleton');
    expect(el.style.width).toBe('40px');
    expect(el.style.borderRadius).toBe('3px');
  });

  it('sem props usa 100% x 16px', () => {
    render(<Skeleton />);
    const el = screen.getByTestId('skeleton');
    expect(el.style.width).toBe('100%');
    expect(el.style.height).toBe('16px');
  });
});

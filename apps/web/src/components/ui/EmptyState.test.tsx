import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState (AT-327)', () => {
  it('mostra a frase, o ícone e o CTA quando há', () => {
    const { container } = render(
      <EmptyState icone={<svg data-testid="icone" />} acao={<button type="button">Criar</button>}>
        Nenhuma ideação ainda.
      </EmptyState>,
    );
    expect(screen.getByText('Nenhuma ideação ainda.')).toBeInTheDocument();
    expect(screen.getByTestId('icone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument();
    expect(container.querySelector('[data-empty-state]')).not.toBeNull();
  });

  it('caso de falha evitado: sem ícone nem CTA, não desenha caixa vazia para eles', () => {
    const { container } = render(<EmptyState>Nada aqui.</EmptyState>);
    const raiz = container.querySelector('[data-empty-state]')!;
    expect(raiz.children).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
    expect(raiz.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('o tom sai por data-tone na raiz e no ícone', () => {
    const { container } = render(
      <EmptyState tom="sucesso" icone={<svg />}>
        Tudo em dia.
      </EmptyState>,
    );
    expect(container.querySelector('[data-empty-state]')).toHaveAttribute('data-tone', 'sucesso');
    expect(container.querySelector('[data-slot="empty-icon"]')).toHaveAttribute('data-tone', 'sucesso');
  });
});

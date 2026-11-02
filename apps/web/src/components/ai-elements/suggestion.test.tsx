import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SugestoesDeAcao } from './suggestion';

describe('SugestoesDeAcao (RN-976)', () => {
  it('clique chama o handler; sem ação, não desenha nada', () => {
    const aoClicar = vi.fn();
    const { container, rerender } = render(
      <SugestoesDeAcao acoes={[{ chave: 'a', rotulo: 'Fazer', aoClicar }]} />,
    );
    expect(aoClicar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fazer' }));
    expect(aoClicar).toHaveBeenCalledTimes(1);
    rerender(<SugestoesDeAcao acoes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('inerte: o motivo vem em texto visível, não em title, e o clique não dispara', () => {
    const aoClicar = vi.fn();
    render(
      <SugestoesDeAcao
        acoes={[{ chave: 'a', rotulo: 'Fazer', aoClicar, desabilitada: true, motivo: 'Falta X', explica: 'dica' }]}
      />,
    );
    const b = screen.getByRole('button', { name: 'Fazer' });
    expect(b).toBeDisabled();
    expect(b).not.toHaveAttribute('title');
    expect(screen.getByText('Falta X')).toBeVisible();
    fireEvent.click(b);
    expect(aoClicar).not.toHaveBeenCalled();
  });
});

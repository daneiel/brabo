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

  it('com ícone: nome acessível é o rótulo, texto visível vazio, e o motivo inerte segue em texto', () => {
    render(
      <SugestoesDeAcao
        acoes={[
          { chave: 'a', rotulo: 'Estou pronto', icone: <svg aria-hidden="true" />, aoClicar: vi.fn(), desabilitada: true, motivo: 'Falta X' },
        ]}
      />,
    );
    const b = screen.getByRole('button', { name: 'Estou pronto' });
    expect(b).toHaveTextContent('');
    expect(screen.getByText('Falta X')).toBeVisible();
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

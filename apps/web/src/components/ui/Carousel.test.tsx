import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Carousel } from './Carousel';

/**
 * Carrossel genérico (RN-148). O que se protege:
 *
 * 1. só o slide ATUAL está montado (`slides.map` nunca chega ao DOM) — cada
 *    slide pode ser um card acionável caro, e montar N pra mostrar 1 seria
 *    trabalho desperdiçado.
 * 2. navegação por seta do teclado, botões prev/next e dots — os três
 *    caminhos levam ao mesmo lugar.
 * 3. o índice nunca aponta pro vazio: encolher `slides` clampa sozinho.
 * 4. ARIA: `role="group"` com `aria-roledescription`, dots como `tablist`,
 *    prev/next desabilitam nas pontas.
 */
function slide(n: number) {
  return { key: `s${n}`, label: `Slide ${n}`, node: <div>Conteúdo {n}</div> };
}

describe('Carousel', () => {
  it('sem slides não renderiza nada', () => {
    const { container } = render(<Carousel ariaLabel="Vazio" slides={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra só o slide atual — os outros não estão no DOM', () => {
    render(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    expect(screen.getByText('Conteúdo 1')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Conteúdo 3')).not.toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
  });

  it('botão "próxima" avança o slide', () => {
    render(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));

    expect(screen.getByText('Conteúdo 2')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo 1')).not.toBeInTheDocument();
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
  });

  it('botão "anterior" desabilitado no primeiro slide, "próxima" no último', () => {
    render(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2)]} />);

    expect(screen.getByRole('button', { name: 'História anterior' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));

    expect(screen.getByRole('button', { name: 'Próxima história' })).toBeDisabled();
  });

  it('as setas do teclado navegam a partir do viewport', () => {
    render(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    const viewport = screen.getByLabelText('Slide 1: Slide 1');
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(screen.getByText('Conteúdo 2')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('Slide 2: Slide 2'), { key: 'ArrowLeft' });
    expect(screen.getByText('Conteúdo 1')).toBeInTheDocument();
  });

  it('os dots pulam direto pro slide clicado, e o ativo tem aria-selected', () => {
    render(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    const dots = screen.getAllByRole('tab');
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(dots[2]);

    expect(screen.getByText('Conteúdo 3')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('índice clampa quando a lista de slides encolhe (história promovida sai da leva)', () => {
    const { rerender } = render(
      <Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    expect(screen.getByText('Conteúdo 3')).toBeInTheDocument();

    rerender(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2)]} />);

    expect(screen.getByText('Conteúdo 2')).toBeInTheDocument();
    expect(screen.getByText('2 de 2')).toBeInTheDocument();
  });

  it('aceita ação extra no cabeçalho (ex.: "Aprovar todas")', () => {
    const onClick = vi.fn();
    render(
      <Carousel
        ariaLabel="Histórias"
        slides={[slide(1), slide(2)]}
        headerActions={
          <button type="button" onClick={onClick}>
            Aprovar todas
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar todas' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

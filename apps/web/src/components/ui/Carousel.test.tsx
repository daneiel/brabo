import type { ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import uiPtBR from '../../locales/pt-BR/ui.json';
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
 *
 * Instância própria de i18next (mesmo padrão de `AccountPage.test.tsx`), só
 * com o namespace `ui` e `lng: 'pt-BR'` — mantém as asserções em português
 * que este teste já fazia antes da extração.
 */
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { ui: uiPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'ui',
    ns: ['ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function renderComI18n(node: ReactElement) {
  return render(<I18nextProvider i18n={novaInstanciaI18n()}>{node}</I18nextProvider>);
}

function slide(n: number) {
  return { key: `s${n}`, label: `Slide ${n}`, node: <div>Conteúdo {n}</div> };
}

describe('Carousel', () => {
  it('sem slides não renderiza nada', () => {
    const { container } = renderComI18n(<Carousel ariaLabel="Vazio" slides={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra só o slide atual — os outros não estão no DOM', () => {
    renderComI18n(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    expect(screen.getByText('Conteúdo 1')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Conteúdo 3')).not.toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
  });

  it('botão "próxima" avança o slide', () => {
    renderComI18n(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));

    expect(screen.getByText('Conteúdo 2')).toBeInTheDocument();
    expect(screen.queryByText('Conteúdo 1')).not.toBeInTheDocument();
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
  });

  it('botão "anterior" desabilitado no primeiro slide, "próxima" no último', () => {
    renderComI18n(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2)]} />);

    expect(screen.getByRole('button', { name: 'História anterior' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));

    expect(screen.getByRole('button', { name: 'Próxima história' })).toBeDisabled();
  });

  it('as setas do teclado navegam a partir do viewport', () => {
    renderComI18n(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    const viewport = screen.getByLabelText('Slide 1: Slide 1');
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(screen.getByText('Conteúdo 2')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('Slide 2: Slide 2'), { key: 'ArrowLeft' });
    expect(screen.getByText('Conteúdo 1')).toBeInTheDocument();
  });

  it('os dots pulam direto pro slide clicado, e o ativo tem aria-selected', () => {
    renderComI18n(<Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />);

    const dots = screen.getAllByRole('tab');
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(dots[2]);

    expect(screen.getByText('Conteúdo 3')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('índice clampa quando a lista de slides encolhe (história promovida sai da leva)', () => {
    const i18n = novaInstanciaI18n();
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <Carousel ariaLabel="Histórias" slides={[slide(1), slide(2), slide(3)]} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima história' }));
    expect(screen.getByText('Conteúdo 3')).toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <Carousel ariaLabel="Histórias" slides={[slide(1), slide(2)]} />
      </I18nextProvider>,
    );

    expect(screen.getByText('Conteúdo 2')).toBeInTheDocument();
    expect(screen.getByText('2 de 2')).toBeInTheDocument();
  });

  it('aceita ação extra no cabeçalho (ex.: "Aprovar todas")', () => {
    const onClick = vi.fn();
    renderComI18n(
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

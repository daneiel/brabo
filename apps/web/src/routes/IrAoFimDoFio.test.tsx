import { describe, it, expect, beforeAll } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import sessionPagePt from '../locales/pt-BR/sessionPage.json';
import { IrAoFimDoFio } from './IrAoFimDoFio';
import { estadoDoIrAoFim } from '../lib/session-rolagem';

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'pt-BR',
    resources: { 'pt-BR': { sessionPage: sessionPagePt } },
  });
});

/** Um fio mínimo: o container que rola (`role="log"`) com o botão dentro. */
function Fio({ total, aprovacoes = 0 }: { total: number; aprovacoes?: number }) {
  return (
    <div role="log" data-testid="fio">
      {Array.from({ length: aprovacoes }, (_, i) => (
        <div key={i} data-aprovacao-no-fio="" />
      ))}
      <IrAoFimDoFio totalDeMensagens={total} />
    </div>
  );
}

function rolar(el: HTMLElement, scrollTop: number) {
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
  el.scrollTop = scrollTop;
  fireEvent.scroll(el);
}

describe('IrAoFimDoFio (RN-836, AT-506)', () => {
  it('caminho feliz: fora do fim e com mensagens novas, mostra o contador; o clique leva ao fim e some', () => {
    const { rerender } = render(<Fio total={5} />);
    const fio = screen.getByTestId('fio');
    act(() => rolar(fio, 0));
    expect(screen.queryByTestId('ir-ao-fim-do-fio')).toBeNull();
    rerender(<Fio total={8} />);
    const botao = screen.getByTestId('ir-ao-fim-do-fio');
    expect(botao).toHaveTextContent('3 mensagens novas');
    expect(botao).toHaveAccessibleName('Ir ao fim da conversa: 3 mensagens novas');
    act(() => fireEvent.click(botao));
    expect(fio.scrollTop).toBe(2000);
    expect(screen.queryByTestId('ir-ao-fim-do-fio')).toBeNull();
  });

  it('aprovação nova realça o botão', () => {
    const { rerender } = render(<Fio total={5} />);
    act(() => rolar(screen.getByTestId('fio'), 0));
    rerender(<Fio total={5} aprovacoes={1} />);
    const botao = screen.getByTestId('ir-ao-fim-do-fio');
    expect(botao).toHaveAttribute('data-aprovacao', 'sim');
    expect(botao).toHaveTextContent('Há uma aprovação esperando');
  });

  it('CASO DE FALHA evitado: no fim, conteúdo novo não mostra botão', () => {
    const { rerender } = render(<Fio total={5} />);
    act(() => rolar(screen.getByTestId('fio'), 1550));
    rerender(<Fio total={9} />);
    expect(screen.queryByTestId('ir-ao-fim-do-fio')).toBeNull();
  });

  it('estadoDoIrAoFim: fora do fim sem nada novo não aparece', () => {
    expect(
      estadoDoIrAoFim({ foraDoFim: true, mensagensAgora: 4, mensagensAoSair: 4, aprovacoesAgora: 0, aprovacoesAoSair: 0 }),
    ).toEqual({ visivel: false, novas: 0, aprovacao: false });
  });
});

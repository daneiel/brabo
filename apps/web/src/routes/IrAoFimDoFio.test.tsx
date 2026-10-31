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
function Fio({ total, aprovacoes = [] }: { total: number; aprovacoes?: string[] }) {
  return (
    <div role="log" data-testid="fio">
      {aprovacoes.map((id) => (
        <div key={id} data-aprovacao-no-fio={id} />
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
    rerender(<Fio total={5} aprovacoes={['a1']} />);
    const botao = screen.getByTestId('ir-ao-fim-do-fio');
    expect(botao).toHaveAttribute('data-aprovacao', 'sim');
    expect(botao).toHaveTextContent('Há uma aprovação esperando');
  });

  it('ação já decidida (sem marca no fio) não realça', () => {
    const { rerender } = render(<Fio total={5} />);
    act(() => rolar(screen.getByTestId('fio'), 0));
    rerender(<Fio total={5} aprovacoes={[]} />);
    expect(screen.queryByTestId('ir-ao-fim-do-fio')).toBeNull();
  });

  it('pendente decidida apaga o realce', () => {
    const { rerender } = render(<Fio total={5} />);
    act(() => rolar(screen.getByTestId('fio'), 0));
    rerender(<Fio total={5} aprovacoes={['a1']} />);
    expect(screen.getByTestId('ir-ao-fim-do-fio')).toHaveAttribute('data-aprovacao', 'sim');
    rerender(<Fio total={5} />);
    expect(screen.queryByTestId('ir-ao-fim-do-fio')).toBeNull();
  });

  it('troca de uma pendente por outra realça', () => {
    const { rerender } = render(<Fio total={5} aprovacoes={['a1']} />);
    act(() => rolar(screen.getByTestId('fio'), 0));
    expect(screen.queryByTestId('ir-ao-fim-do-fio')).toBeNull();
    rerender(<Fio total={5} aprovacoes={['a2']} />);
    expect(screen.getByTestId('ir-ao-fim-do-fio')).toHaveAttribute('data-aprovacao', 'sim');
  });

  it('CASO DE FALHA evitado: no fim, conteúdo novo não mostra botão', () => {
    const { rerender } = render(<Fio total={5} />);
    act(() => rolar(screen.getByTestId('fio'), 1550));
    rerender(<Fio total={9} />);
    expect(screen.queryByTestId('ir-ao-fim-do-fio')).toBeNull();
  });

  it('estadoDoIrAoFim: fora do fim sem nada novo não aparece', () => {
    expect(
      estadoDoIrAoFim({ foraDoFim: true, mensagensAgora: 4, mensagensAoSair: 4, aprovacoesAgora: [], aprovacoesAoSair: [] }),
    ).toEqual({ visivel: false, novas: 0, aprovacao: false });
  });
});

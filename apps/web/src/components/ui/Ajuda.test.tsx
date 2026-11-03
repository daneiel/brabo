import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render as renderRtl, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import uiPtBR from '../../locales/pt-BR/ui.json';
import { Ajuda } from './Ajuda';

function render(node: ReactElement) {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { ui: uiPtBR } },
    lng: 'pt-BR',
    defaultNS: 'ui',
    interpolation: { escapeValue: false },
  });
  return renderRtl(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

const abrir = () => screen.getByRole('button', { name: 'Ajuda: Capacidades' });

describe('Ajuda (AT-712)', () => {
  it('nome acessível "Ajuda: assunto" e texto fora do DOM enquanto fechado', () => {
    render(<Ajuda assunto="Capacidades">Texto longo</Ajuda>);
    expect(abrir()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Texto longo')).toBeNull();
  });

  it('abre no clique e liga o texto por aria-describedby', async () => {
    render(<Ajuda assunto="Capacidades">Texto longo</Ajuda>);
    fireEvent.click(abrir());
    const texto = await screen.findByText('Texto longo');
    expect(abrir()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).toBe(texto.id);
  });

  it('abre pelo teclado (foco + Enter) e fecha com Esc devolvendo o foco', async () => {
    const user = userEvent.setup();
    render(<Ajuda assunto="Capacidades">Texto longo</Ajuda>);
    await user.tab();
    expect(abrir()).toHaveFocus();
    await user.keyboard('{Enter}');
    await screen.findByText('Texto longo');
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Texto longo')).toBeNull();
    expect(abrir()).toHaveFocus();
  });
});

describe('Ajuda alinhamento (R154)', () => {
  it('renderiza dentro do mesmo contêiner do texto', () => {
    render(<h2>Título<Ajuda assunto="Capacidades">x</Ajuda></h2>);
    expect(abrir().closest('h2')).not.toBeNull();
  });
});

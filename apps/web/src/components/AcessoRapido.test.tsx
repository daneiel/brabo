import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import authPtBR from '../locales/pt-BR/auth.json';
import uiPtBR from '../locales/pt-BR/ui.json';
import { acessoRapidoNoBuild } from '../lib/acesso-rapido-build';

const auth = vi.hoisted(() => ({
  papeisDoAcessoRapido: vi.fn(),
  entrarRapido: vi.fn(),
}));
vi.mock('../lib/auth', () => auth);

import AcessoRapido from './AcessoRapido';

function montar() {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { auth: authPtBR, ui: uiPtBR } },
    lng: 'pt-BR',
    defaultNS: 'auth',
    ns: ['auth', 'ui'],
    interpolation: { escapeValue: false },
  });
  const irPara = vi.fn();
  const r = render(
    <I18nextProvider i18n={i18n}>
      <AcessoRapido irPara={irPara} />
    </I18nextProvider>,
  );
  return { irPara, ...r };
}

const PAPEIS = [
  { papel: 'owner', email: 'owner@brabo.dev' },
  { papel: 'viewer', email: 'viewer@brabo.dev' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AcessoRapido', () => {
  it('GET 200: botão aparece e o modal lista os papéis com o aviso', async () => {
    auth.papeisDoAcessoRapido.mockResolvedValue(PAPEIS);
    const { container } = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Acesso rápido' }));
    expect(container.querySelector('[data-acesso-rapido]')).not.toBeNull();
    expect(screen.getByText(/só no ambiente de desenvolvimento local/)).toBeInTheDocument();
    expect(screen.getByText('owner@brabo.dev')).toBeInTheDocument();
    expect(screen.getByText('viewer@brabo.dev')).toBeInTheDocument();
  });

  it('clicar no papel chama o login rápido e navega', async () => {
    auth.papeisDoAcessoRapido.mockResolvedValue(PAPEIS);
    auth.entrarRapido.mockResolvedValue({ ok: true });
    const { irPara } = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Acesso rápido' }));
    fireEvent.click(screen.getByText('owner@brabo.dev'));
    await waitFor(() => expect(irPara).toHaveBeenCalledWith('/'));
    expect(auth.entrarRapido).toHaveBeenCalledWith('owner');
  });

  it('GET 404: nada aparece', async () => {
    auth.papeisDoAcessoRapido.mockResolvedValue(null);
    const { container } = montar();
    await waitFor(() => expect(auth.papeisDoAcessoRapido).toHaveBeenCalled());
    expect(container.querySelector('[data-acesso-rapido]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('erro do POST: a mensagem aparece no modal e não navega', async () => {
    auth.papeisDoAcessoRapido.mockResolvedValue(PAPEIS);
    auth.entrarRapido.mockResolvedValue({ ok: false, status: 409 });
    const { irPara } = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Acesso rápido' }));
    fireEvent.click(screen.getByText('viewer@brabo.dev'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível entrar');
    expect(irPara).not.toHaveBeenCalled();
  });
});

describe('acessoRapidoNoBuild', () => {
  it('só o valor local liga', () => {
    expect(acessoRapidoNoBuild('local')).toBe(true);
    for (const v of [undefined, '', 'dev', 'prd', 'LOCAL']) {
      expect(acessoRapidoNoBuild(v)).toBe(false);
    }
  });
});

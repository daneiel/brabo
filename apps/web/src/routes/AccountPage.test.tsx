import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import commonEn from '../locales/en/common.json';
import commonPtBR from '../locales/pt-BR/common.json';
import { ToastProvider } from '../components/ui/ToastProvider';
import { AccountPage } from './AccountPage';

/**
 * A tela de conta (fundação de i18n, Onda 6a).
 *
 * O que importa provar AQUI não é a mecânica de `idioma.ts` (isso é
 * `idioma.test.ts`) — é que a PÁGINA reage de verdade: trocar o seletor muda
 * o texto que a própria tela mostra, via `react-i18next`. Por isso o teste
 * roda contra uma instância REAL de i18next com os dois recursos, e só
 * `definirIdioma` é mockado (a chamada ao servidor).
 */

const { emailDaSessaoMock } = vi.hoisted(() => ({
  emailDaSessaoMock: vi.fn<() => string | null>(() => 'fulano@brabo.dev'),
}));
vi.mock('../lib/auth', () => ({ emailDaSessao: emailDaSessaoMock }));

const { definirIdiomaMock } = vi.hoisted(() => ({
  definirIdiomaMock: vi.fn(),
}));
vi.mock('../lib/idioma', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/idioma')>();
  return {
    ...original,
    definirIdioma: (...args: Parameters<typeof original.definirIdioma>) =>
      definirIdiomaMock(...args),
  };
});

function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: {
      en: { common: commonEn },
      'pt-BR': { common: commonPtBR },
    },
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montar() {
  const i18n = novaInstanciaI18n();
  render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <AccountPage />
      </ToastProvider>
    </I18nextProvider>,
  );
  return { i18n };
}

beforeEach(() => {
  emailDaSessaoMock.mockClear();
  definirIdiomaMock.mockReset();
});

describe('AccountPage', () => {
  it('mostra a identidade da sessão e o título em inglês (default do app)', () => {
    montar();
    expect(screen.getByText('fulano@brabo.dev', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Language', level: 2 })).toBeInTheDocument();
  });

  it('trocar o idioma reflete no texto da PRÓPRIA página', async () => {
    definirIdiomaMock.mockImplementation(async (novo: string, i18n) => {
      await i18n.changeLanguage(novo);
    });
    montar();

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'pt-BR' },
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Conta' })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Idioma', level: 2 })).toBeInTheDocument();
    expect(definirIdiomaMock).toHaveBeenCalledWith('pt-BR', expect.anything());
  });

  it('sem sessão (sem e-mail), a tela ainda renderiza sem quebrar', () => {
    emailDaSessaoMock.mockReturnValue(null);
    montar();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('falha ao salvar: mostra o erro e NÃO troca o idioma exibido', async () => {
    definirIdiomaMock.mockRejectedValue(new Error('offline'));
    montar();

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'pt-BR' },
    });

    expect(await screen.findByText(/could not save/i)).toBeInTheDocument();
    // O `i18n` real nunca mudou de idioma — a chamada falhou antes.
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });
});

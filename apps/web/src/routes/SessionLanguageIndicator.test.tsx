import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import responseLanguagePtBR from '../locales/pt-BR/responseLanguage.json';
import responseLanguageEn from '../locales/en/responseLanguage.json';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiError } from '../lib/api-client';
import type { SessionResponseLanguage } from '../lib/api-types';
import {
  SessionLanguageIndicator,
  idiomaSemOverride,
} from './SessionLanguageIndicator';

/**
 * O idioma das respostas na barra da sessão (RN-620).
 *
 * O que pode dar errado: mostrar o idioma sem a ORIGEM (ou colapsar
 * "interface" e "detectado" em "escolhido"), trocar para a sessão inteira em
 * vez de só para quem vê, esconder de quem não pode trocar o valor que vale
 * para ele, e afirmar que os agentes já respondem nesse idioma.
 */

const getSessionResponseLanguage = vi.fn();
const setSessionResponseLanguage = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
}));

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getSessionResponseLanguage: (...args: unknown[]) =>
      getSessionResponseLanguage(...args),
    setSessionResponseLanguage: (...args: unknown[]) =>
      setSessionResponseLanguage(...args),
  };
});

const PELA_INTERFACE: SessionResponseLanguage = {
  language: 'pt-BR',
  origin: 'interface',
  sessionOverride: null,
  account: 'automatico',
  detected: null,
  interfaceLocale: 'pt-BR',
};

function montar(papel: string | undefined = 'developer') {
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: papel ? { workspace: { id: 'w1' }, role: papel } : undefined,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      'pt-BR': { responseLanguage: responseLanguagePtBR },
      en: { responseLanguage: responseLanguageEn },
    },
    lng: 'pt-BR',
    fallbackLng: 'en',
    defaultNS: 'responseLanguage',
    ns: ['responseLanguage'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <SessionLanguageIndicator projectId="p1" sessionId="s1" />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getSessionResponseLanguage.mockReset();
  setSessionResponseLanguage.mockReset();
});

describe('SessionLanguageIndicator (RN-620)', () => {
  it('mostra o efetivo COM a origem e o link para a Conta — sem o aviso de "ainda não chega" (RN-622)', async () => {
    getSessionResponseLanguage.mockResolvedValue(PELA_INTERFACE);
    montar();

    const origem = await screen.findByTestId('origem-do-idioma');
    expect(origem.textContent).toMatch(/pt-BR.*o idioma da interface/);
    expect(origem.textContent).not.toMatch(/ainda não chega aos agentes/);
    expect(screen.getByRole('link', { name: 'Conta' })).toHaveAttribute(
      'href',
      '/account',
    );
  });

  it('cada origem tem texto próprio — o detectado não vira "escolhido"', async () => {
    getSessionResponseLanguage.mockResolvedValue({
      ...PELA_INTERFACE,
      language: 'en',
      origin: 'detectado',
      detected: 'en',
    });
    montar();

    const origem = await screen.findByTestId('origem-do-idioma');
    expect(origem.textContent).toMatch(/detectado pelas suas mensagens e confirmado por você/);
    expect(origem.textContent).not.toMatch(/escolhido/);
  });

  it('trocar na barra fixa o idioma SÓ nesta sessão, pela rota de override', async () => {
    getSessionResponseLanguage.mockResolvedValue(PELA_INTERFACE);
    setSessionResponseLanguage.mockResolvedValue({
      ...PELA_INTERFACE,
      language: 'es',
      origin: 'sessao',
      sessionOverride: 'es',
    });
    montar();
    const seletor = await screen.findByRole('combobox', {
      name: 'Idioma das respostas nesta sessão',
    });

    fireEvent.change(seletor, { target: { value: 'es' } });

    await waitFor(() =>
      expect(setSessionResponseLanguage).toHaveBeenCalledWith('p1', 's1', 'es'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('origem-do-idioma').textContent).toMatch(
        /fixado por você nesta sessão/,
      ),
    );
  });

  it('"Seguir a Conta" solta o override mandando null, e diz em que idioma isso dá', async () => {
    getSessionResponseLanguage.mockResolvedValue({
      ...PELA_INTERFACE,
      language: 'es',
      origin: 'sessao',
      sessionOverride: 'es',
      account: 'fr',
    });
    setSessionResponseLanguage.mockResolvedValue({
      ...PELA_INTERFACE,
      language: 'fr',
      origin: 'conta',
      account: 'fr',
    });
    montar();
    const seletor = await screen.findByRole('combobox', {
      name: 'Idioma das respostas nesta sessão',
    });
    expect(
      screen.getByRole('option', { name: /Seguir a Conta \(.*\(fr\)\)/ }),
    ).toBeInTheDocument();

    fireEvent.change(seletor, { target: { value: '' } });

    await waitFor(() =>
      expect(setSessionResponseLanguage).toHaveBeenCalledWith('p1', 's1', null),
    );
  });

  it('código recusado pela api: o toast traz a frase da api', async () => {
    getSessionResponseLanguage.mockResolvedValue(PELA_INTERFACE);
    setSessionResponseLanguage.mockRejectedValue(
      new ApiError(400, { message: '"zz" não é um código de idioma BCP-47 reconhecido' }),
    );
    montar();
    const seletor = await screen.findByRole('combobox', {
      name: 'Idioma das respostas nesta sessão',
    });

    fireEvent.change(seletor, { target: { value: '__outro__' } });
    fireEvent.change(
      screen.getByLabelText('Código de idioma (BCP-47) para esta sessão'),
      { target: { value: 'zz' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fixar' }));

    expect(
      await screen.findByText(/não é um código de idioma BCP-47/),
    ).toBeInTheDocument();
  });

  it('abaixo de developer: o valor e a origem ficam, o seletor fica inerte e o motivo vem em texto', async () => {
    getSessionResponseLanguage.mockResolvedValue(PELA_INTERFACE);
    montar('viewer');

    const origem = await screen.findByTestId('origem-do-idioma');
    expect(origem.textContent).toMatch(/trocar aqui pede papel developer/);
    expect(
      screen.getByRole('combobox', { name: 'Idioma das respostas nesta sessão' }),
    ).toBeDisabled();
  });

  it('leitura falhada tem texto próprio, e não finge um idioma', async () => {
    getSessionResponseLanguage.mockRejectedValue(new ApiError(500, { message: 'boom' }));
    montar();

    expect(
      await screen.findByText('Idioma das respostas indisponível'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('idiomaSemOverride — o que "Seguir a Conta" dá', () => {
  it('conta > detectado > interface', () => {
    expect(idiomaSemOverride({ ...PELA_INTERFACE, account: 'fr', detected: 'en' })).toBe('fr');
    expect(idiomaSemOverride({ ...PELA_INTERFACE, detected: 'en' })).toBe('en');
    expect(idiomaSemOverride(PELA_INTERFACE)).toBe('pt-BR');
  });
});

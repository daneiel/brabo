import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import responseLanguageEn from '../locales/en/responseLanguage.json';
import responseLanguagePtBR from '../locales/pt-BR/responseLanguage.json';
import uiEn from '../locales/en/ui.json';
import uiPtBR from '../locales/pt-BR/ui.json';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiError } from '../lib/api-client';
import type { UserPreferences } from '../lib/api-types';
import { ResponseLanguageSection } from './ResponseLanguageSection';

/**
 * O idioma das respostas na Conta (RN-618).
 *
 * O que pode dar errado aqui é o que a tela AFIRMA: o efetivo sem origem, a
 * escolha nomeada exigindo um botão, o código digitado indo à api a cada
 * tecla, e o idioma da interface sendo escrito junto.
 */

const getMyPreferences = vi.fn();
const updateMyPreferences = vi.fn();

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getMyPreferences: (...args: unknown[]) => getMyPreferences(...args),
    updateMyPreferences: (...args: unknown[]) => updateMyPreferences(...args),
  };
});

const AUTOMATICO: UserPreferences = {
  locale: 'pt-BR',
  responseLanguage: 'automatico',
  detectedLanguage: null,
  detectedLanguageConfirmedAt: null,
  effectiveResponseLanguage: { language: 'pt-BR', origin: 'interface' },
};

function montar(lng: 'en' | 'pt-BR' = 'pt-BR') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      en: { responseLanguage: responseLanguageEn, ui: uiEn },
      'pt-BR': { responseLanguage: responseLanguagePtBR, ui: uiPtBR },
    },
    lng,
    fallbackLng: 'en',
    defaultNS: 'responseLanguage',
    ns: ['responseLanguage', 'ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <ResponseLanguageSection />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMyPreferences.mockReset();
  updateMyPreferences.mockReset();
});

describe('ResponseLanguageSection (RN-618)', () => {
  it('conta nova: mostra Automático e DIZ de onde vem o idioma efetivo', async () => {
    getMyPreferences.mockResolvedValue(AUTOMATICO);
    montar();

    const efetivo = await screen.findByTestId('idioma-efetivo');
    await waitFor(() =>
      expect(efetivo.textContent).toMatch(/pt-BR.*idioma da interface/),
    );
    expect(
      (screen.getByLabelText('Idioma das respostas dos agentes') as HTMLSelectElement)
        .value,
    ).toBe('automatico');
    // RN-622: o valor chega ao modelo, e o aviso de "ainda não chega" saiu.
    expect(screen.queryByText(/Ainda não chega aos agentes/)).not.toBeInTheDocument();
  });

  it('escolher um idioma NOMEADO salva no onChange e só manda o idioma das respostas', async () => {
    getMyPreferences.mockResolvedValue(AUTOMATICO);
    updateMyPreferences.mockResolvedValue({
      ...AUTOMATICO,
      responseLanguage: 'es',
      effectiveResponseLanguage: { language: 'es', origin: 'conta' },
    });
    montar();
    const seletor = await screen.findByLabelText('Idioma das respostas dos agentes');
    await waitFor(() => expect(seletor).not.toBeDisabled());

    fireEvent.change(seletor, { target: { value: 'es' } });

    await waitFor(() =>
      expect(updateMyPreferences).toHaveBeenCalledWith({ responseLanguage: 'es' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('idioma-efetivo').textContent).toMatch(
        /escolhido por você na Conta/,
      ),
    );
  });

  it('"Outro código…" abre um campo e só salva no botão — digitar não chama a api', async () => {
    getMyPreferences.mockResolvedValue(AUTOMATICO);
    updateMyPreferences.mockResolvedValue({
      ...AUTOMATICO,
      responseLanguage: 'fr-CA',
      effectiveResponseLanguage: { language: 'fr-CA', origin: 'conta' },
    });
    montar();
    const seletor = await screen.findByLabelText('Idioma das respostas dos agentes');
    await waitFor(() => expect(seletor).not.toBeDisabled());

    fireEvent.change(seletor, { target: { value: '__outro__' } });
    const campo = screen.getByLabelText('Código de idioma (BCP-47)');
    fireEvent.change(campo, { target: { value: 'fr-ca' } });
    expect(updateMyPreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(updateMyPreferences).toHaveBeenCalledWith({ responseLanguage: 'fr-ca' }),
    );
  });

  it('código recusado pela api: o toast traz a frase da api e o valor não muda', async () => {
    getMyPreferences.mockResolvedValue(AUTOMATICO);
    updateMyPreferences.mockRejectedValue(
      new ApiError(400, { message: '"zz" não é um código de idioma BCP-47 reconhecido' }),
    );
    montar();
    const seletor = await screen.findByLabelText('Idioma das respostas dos agentes');
    await waitFor(() => expect(seletor).not.toBeDisabled());

    fireEvent.change(seletor, { target: { value: '__outro__' } });
    fireEvent.change(screen.getByLabelText('Código de idioma (BCP-47)'), {
      target: { value: 'zz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(
      await screen.findByText(/não é um código de idioma BCP-47/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('idioma-efetivo').textContent).toMatch(/idioma da interface/);
  });

  it('o detectado confirmado aparece nomeado, e o idioma gravado fora da lista sugerida vira opção', async () => {
    getMyPreferences.mockResolvedValue({
      ...AUTOMATICO,
      responseLanguage: 'pt-PT',
      detectedLanguage: 'en',
      detectedLanguageConfirmedAt: '2026-09-20T00:00:00.000Z',
      effectiveResponseLanguage: { language: 'pt-PT', origin: 'conta' },
    });
    montar('en');

    expect(
      await screen.findByText(/detected from your messages and confirmed by you: .*\(en\)/),
    ).toBeInTheDocument();
    const seletor = screen.getByLabelText("Agents' response language") as HTMLSelectElement;
    await waitFor(() => expect(seletor.value).toBe('pt-PT'));
  });

  it('leitura falhada tem texto próprio, e o seletor fica inerte', async () => {
    getMyPreferences.mockRejectedValue(new ApiError(500, { message: 'boom' }));
    montar();

    expect(
      await screen.findByText('Não foi possível ler o idioma das respostas.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Idioma das respostas dos agentes')).toBeDisabled();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import settingsEn from '../../locales/en/settings.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import type { Project } from '../../lib/api-types';
import { ProjectLanguageSection } from './ProjectLanguageSection';

/**
 * O idioma do PROJETO em Configurações (RN-619).
 *
 * O que pode dar errado: a escolha nomeada exigir botão (ou o código digitado
 * ir à api a cada tecla), quem não alcança o mínimo do ENDPOINT perder a
 * INFORMAÇÃO junto com o controle, e a tela afirmar que os agentes já
 * escrevem nesse idioma.
 */

const getProject = vi.fn();
const updateProject = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
}));

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getProject: (...args: unknown[]) => getProject(...args),
    updateProject: (...args: unknown[]) => updateProject(...args),
  };
});

const PROJETO = {
  id: 'p1',
  workspaceId: 'w1',
  name: 'Loja',
  slug: 'loja',
  language: 'pt-BR',
} as unknown as Project;

function montar(papel: string | undefined = 'maintainer') {
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: papel ? { workspace: { id: 'w1' }, role: papel } : undefined,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { settings: settingsPtBR }, en: { settings: settingsEn } },
    lng: 'pt-BR',
    fallbackLng: 'en',
    defaultNS: 'settings',
    ns: ['settings'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <ProjectLanguageSection projectId="p1" />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getProject.mockReset();
  updateProject.mockReset();
  getProject.mockResolvedValue(PROJETO);
});

describe('ProjectLanguageSection (RN-619)', () => {
  it('mostra o idioma vigente e DIZ o que ainda não segue ele (os artefatos de turno com autor)', async () => {
    montar();

    expect(await screen.findByText(/Hoje: .*\(pt-BR\)/)).toBeInTheDocument();
    // RN-622: os turnos sem autor já seguem o idioma do projeto; a lacuna que
    // sobra é declarada, e o aviso antigo de "ainda não chega" saiu.
    expect(screen.queryByText(/Ainda não chega aos agentes/)).not.toBeInTheDocument();
    expect(screen.getByText(/Os turnos sem autor já seguem este idioma/)).toBeInTheDocument();
  });

  it('escolher um idioma NOMEADO salva no onChange, pela rota do projeto', async () => {
    updateProject.mockResolvedValue({ ...PROJETO, language: 'es' });
    montar();
    const seletor = await screen.findByRole('combobox', { name: 'Idioma do projeto' });

    fireEvent.change(seletor, { target: { value: 'es' } });

    await waitFor(() =>
      expect(updateProject).toHaveBeenCalledWith('p1', { language: 'es' }),
    );
  });

  it('código digitado só vai à api no botão, e a recusa traz a frase da api', async () => {
    updateProject.mockRejectedValue(
      new ApiError(400, { message: '"zz" não é um código de idioma BCP-47 reconhecido' }),
    );
    montar();
    const seletor = await screen.findByRole('combobox', { name: 'Idioma do projeto' });

    fireEvent.change(seletor, { target: { value: '__outro__' } });
    fireEvent.change(screen.getByLabelText('Código de idioma (BCP-47)'), {
      target: { value: 'zz' },
    });
    expect(updateProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(
      await screen.findByText(/não é um código de idioma BCP-47/),
    ).toBeInTheDocument();
  });

  it('abaixo de maintainer: o valor continua na tela, o controle fica inerte e o motivo vem em TEXTO', async () => {
    montar('developer');

    expect(await screen.findByText(/Hoje: .*\(pt-BR\)/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Idioma do projeto' })).toBeDisabled();
    expect(
      screen.getByText(/Só quem é maintainer ou owner do projeto/),
    ).toBeInTheDocument();
  });
});

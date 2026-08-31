import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import terminalPtBR from '../locales/pt-BR/terminal.json';

/**
 * Os TRÊS estados da espera do runner (RN-474, RN-088): `esperando`,
 * `confirmado` e `semResposta` nunca colapsam, e a espera nunca é eterna.
 *
 * O que a prova precisa cobrir, além dos três: que `confirmado` é o carimbo
 * MUDAR e não "existir" — um projeto que já tinha `workspaceVerifiedAt`
 * quando a espera começou não pode ser anunciado como recém-conectado.
 */

const { getProjectMock } = vi.hoisted(() => ({ getProjectMock: vi.fn() }));

vi.mock('../lib/api-client', () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
}));

import { EsperaDoRunner, TETO_MS } from './EsperaDoRunner';

function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { terminal: terminalPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'terminal',
    ns: ['terminal'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function renderComProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={novaInstanciaI18n()}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

function projeto(campos: { workspaceVerifiedAt: string | null; workspacePath?: string | null }) {
  return {
    id: 'proj-1',
    workspacePath: campos.workspacePath ?? null,
    workspaceVerifiedAt: campos.workspaceVerifiedAt,
  };
}

beforeEach(() => {
  getProjectMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EsperaDoRunner', () => {
  it('estado 1 — `esperando`: sonda em silêncio e diz que avisa sozinha, com o teto declarado', async () => {
    getProjectMock.mockResolvedValue(projeto({ workspaceVerifiedAt: null }));

    renderComProviders(<EsperaDoRunner projectId="proj-1" />);

    expect(await screen.findByText('Procurando o runner…')).toBeInTheDocument();
    // O teto NÃO é silencioso (RN-180/RN-468): a tela diz quando para.
    expect(screen.getByText(/Paramos de procurar depois de 3 minutos/)).toBeInTheDocument();
    expect(screen.queryByText(/Runner conectado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Não vimos o runner/)).not.toBeInTheDocument();
  });

  it('estado 2 — `confirmado`: o carimbo MUDA e a tela mostra o caminho que o RUNNER reportou', async () => {
    getProjectMock
      .mockResolvedValueOnce(projeto({ workspaceVerifiedAt: null }))
      .mockResolvedValue(
        projeto({
          workspaceVerifiedAt: '2026-08-30T12:00:00.000Z',
          workspacePath: '/home/dani/projetos/exp002',
        }),
      );

    renderComProviders(<EsperaDoRunner projectId="proj-1" />);
    await screen.findByText('Procurando o runner…');

    expect(await screen.findByText(/Runner conectado/, {}, { timeout: 6000 })).toBeInTheDocument();
    // O caminho do runner é a verdade — a tela não compete com ele, mostra o dele.
    expect(screen.getByText('/home/dani/projetos/exp002')).toBeInTheDocument();
    expect(screen.getByText(/ele substitui o que tiver sido digitado antes/)).toBeInTheDocument();
    expect(screen.queryByText('Procurando o runner…')).not.toBeInTheDocument();
  }, 10_000);

  it('carimbo que JÁ EXISTIA quando a espera começou não conta como conexão nova', async () => {
    // Projeto reconfigurado: `workspaceVerifiedAt` já estava preenchido, e
    // reconectar com o MESMO caminho não o regrava. Anunciar "conectado" aqui
    // seria transformar um proxy em garantia (RN-468).
    getProjectMock.mockResolvedValue(
      projeto({ workspaceVerifiedAt: '2026-08-01T00:00:00.000Z', workspacePath: '/velho' }),
    );

    renderComProviders(<EsperaDoRunner projectId="proj-1" />);

    expect(await screen.findByText('Procurando o runner…')).toBeInTheDocument();
    await waitFor(() => expect(getProjectMock).toHaveBeenCalled());
    expect(screen.queryByText(/Runner conectado/)).not.toBeInTheDocument();
  });

  it('estado 3 — `semResposta`: o teto estoura, a tela declara o que NÃO sabe e oferece recomeçar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    getProjectMock.mockResolvedValue(projeto({ workspaceVerifiedAt: null }));

    renderComProviders(<EsperaDoRunner projectId="proj-1" />);
    await screen.findByText('Procurando o runner…');

    await vi.advanceTimersByTimeAsync(TETO_MS + 1_000);

    expect(await screen.findByText(/Não vimos o runner conectar em 3 minutos/)).toBeInTheDocument();
    // Ausência de sinal não é prova de ausência — e a tela diz de onde vem o
    // limite dela, apontando quem sabe do agora.
    expect(screen.getByText(/Isso não prova que ele não está rodando/)).toBeInTheDocument();
    expect(screen.getByText(/aba Código/)).toBeInTheDocument();
    expect(screen.queryByText('Procurando o runner…')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Procurar de novo' }));
    expect(await screen.findByText('Procurando o runner…')).toBeInTheDocument();
    expect(screen.queryByText(/Não vimos o runner conectar/)).not.toBeInTheDocument();
  }, 15_000);
});

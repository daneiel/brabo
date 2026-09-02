import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import provisioningPtBR from '../locales/pt-BR/provisioning.json';

/**
 * O que a tela de provisionamento diz quando NÃO deu certo.
 *
 * Esta página não tinha teste nenhum, e o defeito que isso deixou passar foi o
 * de uso real: o POST falhava com "permissão negada: /data/git-repos/x.git", o
 * `.catch(() => {})` engolia a mensagem, `GET .../git/bootstrap` devolvia
 * `{status: null}` porque a linha de bootstrap nunca chegou a ser criada, e a
 * tela ficava em "Iniciando provisionamento…" pollando de segundo em segundo,
 * **sem botão nenhum**. Não havia como saber o motivo nem como tentar de novo.
 *
 * As três coisas que se prova aqui são as três que faltavam: o motivo aparece,
 * a saída existe, e a espera acaba.
 */

const {
  getProjectMock,
  getRepositoryMock,
  getBootstrapStatusMock,
  provisionRepositoryMock,
  listSessionEventsMock,
} = vi.hoisted(() => ({
  getProjectMock: vi.fn(),
  getRepositoryMock: vi.fn(),
  getBootstrapStatusMock: vi.fn(),
  provisionRepositoryMock: vi.fn(),
  listSessionEventsMock: vi.fn(),
}));

vi.mock('../lib/api-client', async () => {
  const real =
    await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    // `ApiError` e `mensagemDaApi` de VERDADE: o que se prova é a extração da
    // frase do corpo da resposta — dublá-los testaria o dublê.
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    API_URL: real.API_URL,
    getProject: (...a: unknown[]) => getProjectMock(...a),
    getRepository: (...a: unknown[]) => getRepositoryMock(...a),
    getBootstrapStatus: (...a: unknown[]) => getBootstrapStatusMock(...a),
    provisionRepository: (...a: unknown[]) => provisionRepositoryMock(...a),
    listSessionEvents: (...a: unknown[]) => listSessionEventsMock(...a),
    acknowledgeProtectionFailure: vi.fn(),
  };
});

import { ApiError } from '../lib/api-client';
import { ProvisioningPage } from './ProvisioningPage';

function renderComProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { provisioning: provisioningPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'provisioning',
    ns: ['provisioning'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

/** O que a api devolve quando NÃO há linha de bootstrap — o caso do defeito. */
const SEM_LINHA = {
  status: null,
  sessionId: null,
  failedStep: null,
  lastError: null,
  attempts: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  getProjectMock.mockResolvedValue({
    id: 'proj-1',
    name: 'exp001',
    slug: 'exp001',
    workspaceId: 'ws-1',
  });
  getRepositoryMock.mockResolvedValue(null);
  getBootstrapStatusMock.mockResolvedValue(SEM_LINHA);
  listSessionEventsMock.mockResolvedValue({ items: [], nextCursor: null });
  provisionRepositoryMock.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('provisionamento — o POST recusa', () => {
  it('mostra o motivo da api em vez de "Iniciando provisionamento…"', async () => {
    provisionRepositoryMock.mockRejectedValue(
      new ApiError(500, {
        message: 'permissão negada: /data/git-repos/exp001.git',
      }),
    );

    renderComProviders(<ProvisioningPage projectId="proj-1" provider="local" />);

    expect(
      await screen.findByText(/permissão negada: \/data\/git-repos\/exp001\.git/),
    ).toBeTruthy();
    // O texto de "começando" some: não há nada começando.
    expect(screen.queryByText('Iniciando provisionamento…')).toBeNull();
  });

  it('oferece "Tentar novamente" mesmo SEM status provision_failed', async () => {
    provisionRepositoryMock.mockRejectedValue(
      new ApiError(500, { message: 'permissão negada' }),
    );

    renderComProviders(<ProvisioningPage projectId="proj-1" provider="local" />);

    // O botão dependia de `status === 'provision_failed'`, que nunca chega
    // quando a linha de bootstrap não existe — era essa dependência que
    // deixava a tela sem saída nenhuma.
    const botao = await screen.findByRole('button', { name: 'Tentar novamente' });

    provisionRepositoryMock.mockResolvedValue({});
    await userEvent.click(botao);

    await waitFor(() => expect(provisionRepositoryMock).toHaveBeenCalledTimes(2));
    // Tentativa nova zera o desfecho da anterior — a tela não afirma sobre o
    // que ainda não aconteceu.
    await waitFor(() => expect(screen.queryByText(/permissão negada/)).toBeNull());
  });
});

describe('provisionamento — a espera tem teto', () => {
  it('para de esperar e diz o que NÃO sabe, em vez de girar para sempre', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // POST que nunca resolve: o servidor está trabalhando (ou travou), e a
    // tela não tem como saber qual dos dois.
    provisionRepositoryMock.mockReturnValue(new Promise(() => {}));

    renderComProviders(<ProvisioningPage projectId="proj-1" provider="local" />);

    expect(await screen.findByText('Trabalhando…')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(180_000 + 1_000);

    expect(
      await screen.findByText(/Paramos de acompanhar depois de 3 minutos/),
    ).toBeTruthy();
    // A ressalva é obrigatória: o teto não é prova de fracasso.
    expect(screen.getByText(/Isso não prova que falhou/)).toBeTruthy();
    // E a saída não é um segundo POST — o provisionamento pode estar rodando.
    expect(screen.getByRole('button', { name: 'Procurar de novo' })).toBeTruthy();
    expect(provisionRepositoryMock).toHaveBeenCalledTimes(1);
  });
});

describe('provisionamento — falha COM linha de bootstrap', () => {
  it('sem passo nomeado, o título não inventa um', async () => {
    getBootstrapStatusMock.mockResolvedValue({
      ...SEM_LINHA,
      status: 'provision_failed',
      lastError: 'o provider recusou',
    });

    renderComProviders(<ProvisioningPage projectId="proj-1" provider="local" />);

    // `failedStep` é `null`: nenhum passo do Gitflow chegou a ser tentado.
    // "Falhou em: null" seria a tela preenchendo a frase com o que não tem.
    expect(
      await screen.findByText('Não foi possível criar o repositório'),
    ).toBeTruthy();
    expect(screen.getByText('o provider recusou')).toBeTruthy();
  });
});

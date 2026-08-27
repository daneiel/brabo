import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HuggingFaceModelBrowser } from './HuggingFaceModelBrowser';
import { ToastProvider } from './ui/ToastProvider';
// A instância REAL do app: o componente usa `useTranslation('models')` sem
// `I18nextProvider` próprio — mesmo padrão de `ModelCatalogSection.test.tsx`.
import i18n from '../lib/i18n';
import type { HuggingFaceModel, ModelPullRequest } from '../lib/api-types';

const searchHuggingFaceModels = vi.fn();
const requestModelPull = vi.fn();
const confirmModelPull = vi.fn();
const getModelPullRequest = vi.fn();

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    searchHuggingFaceModels: (...args: unknown[]) => searchHuggingFaceModels(...args),
    requestModelPull: (...args: unknown[]) => requestModelPull(...args),
    confirmModelPull: (...args: unknown[]) => confirmModelPull(...args),
    getModelPullRequest: (...args: unknown[]) => getModelPullRequest(...args),
  };
});

const HF_MODEL: HuggingFaceModel = {
  repoId: 'meta-llama/Llama-3.1-8B-Instruct-GGUF',
  publisher: 'meta-llama',
  downloads: 182034,
  likes: 210,
  official: true,
};

function pullRequest(over: Partial<ModelPullRequest> = {}): ModelPullRequest {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    requestedBy: 'u-1',
    repoId: HF_MODEL.repoId,
    estimatedSizeBytes: 4_900_000_000,
    status: 'pending_confirmation',
    confirmedAt: null,
    failedReason: null,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    ...over,
  };
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HuggingFaceModelBrowser workspaceId="ws-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
});

describe('HuggingFaceModelBrowser', () => {
  it('o toggle de comunidade nasce desligado e só mostra o aviso de segurança quando ligado', async () => {
    const user = userEvent.setup();
    montar();

    expect(screen.queryByText(/reuploads de terceiros/)).not.toBeInTheDocument();

    const toggle = screen.getByRole('checkbox', {
      name: 'Mostrar modelos da comunidade (não oficiais)',
    });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(await screen.findByText(/reuploads de terceiros/)).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText(/reuploads de terceiros/)).not.toBeInTheDocument();
  });

  it('busca a comunidade quando o toggle liga, mantendo só oficiais quando desligado', async () => {
    const user = userEvent.setup();
    searchHuggingFaceModels.mockResolvedValue([HF_MODEL]);
    montar();

    await user.type(
      screen.getByLabelText('Buscar modelo no Hugging Face Hub'),
      'llama',
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() =>
      expect(searchHuggingFaceModels).toHaveBeenCalledWith('ws-1', {
        q: 'llama',
        includeCommunity: false,
      }),
    );

    await user.click(
      screen.getByRole('checkbox', { name: 'Mostrar modelos da comunidade (não oficiais)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() =>
      expect(searchHuggingFaceModels).toHaveBeenCalledWith('ws-1', {
        q: 'llama',
        includeCommunity: true,
      }),
    );
  });

  it('fluxo de confirmar-antes-de-puxar: cria o pedido ao abrir o modal e só confirma no clique explícito', async () => {
    const user = userEvent.setup();
    searchHuggingFaceModels.mockResolvedValue([HF_MODEL]);
    requestModelPull.mockResolvedValue(pullRequest());
    confirmModelPull.mockResolvedValue(pullRequest({ status: 'pulling' }));
    getModelPullRequest.mockResolvedValue(pullRequest({ status: 'active' }));

    montar();

    await user.type(
      screen.getByLabelText('Buscar modelo no Hugging Face Hub'),
      'llama',
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText(HF_MODEL.repoId)).toBeInTheDocument();
    expect(requestModelPull).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Puxar' }));

    // Abrir a confirmação já dispara o primeiro POST (cria em
    // `pending_confirmation`) — é dali que vem a estimativa de tamanho.
    await waitFor(() =>
      expect(requestModelPull).toHaveBeenCalledWith('ws-1', { repoId: HF_MODEL.repoId }),
    );
    expect(await screen.findByText('4.6 GB')).toBeInTheDocument();
    expect(confirmModelPull).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirmar e puxar' }));

    // O segundo POST só sai no clique explícito, nunca antes.
    await waitFor(() =>
      expect(confirmModelPull).toHaveBeenCalledWith('ws-1', 'pr-1'),
    );
    // O modal fecha imediatamente — o pull roda no servidor, sem segurar a UI.
    expect(screen.queryByRole('button', { name: 'Confirmar e puxar' })).not.toBeInTheDocument();

    // O status final chega pelo POLL, não pela resposta do confirm.
    await waitFor(() =>
      expect(getModelPullRequest).toHaveBeenCalledWith('ws-1', 'pr-1'),
    );
    expect(await screen.findByText(/puxado e ativado/)).toBeInTheDocument();
  });

  it('CASO DE FALHA: pull que termina em failed mostra o motivo no toast', async () => {
    const user = userEvent.setup();
    searchHuggingFaceModels.mockResolvedValue([HF_MODEL]);
    requestModelPull.mockResolvedValue(pullRequest());
    confirmModelPull.mockResolvedValue(pullRequest({ status: 'pulling' }));
    getModelPullRequest.mockResolvedValue(
      pullRequest({ status: 'failed', failedReason: 'infra: Ollama indisponível' }),
    );

    montar();

    await user.type(
      screen.getByLabelText('Buscar modelo no Hugging Face Hub'),
      'llama',
    );
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await user.click(await screen.findByRole('button', { name: 'Puxar' }));
    await screen.findByText('4.6 GB');
    await user.click(screen.getByRole('button', { name: 'Confirmar e puxar' }));

    expect(await screen.findByText(/infra: Ollama indisponível/)).toBeInTheDocument();
  });
});

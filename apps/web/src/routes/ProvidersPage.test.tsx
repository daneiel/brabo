import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ProvidersPage } from './ProvidersPage';
import '../lib/i18n';

const listProviderCapabilities = vi.fn();
vi.mock('../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api-client')>()),
  listProviderCapabilities: () => listProviderCapabilities(),
}));

const useCurrentWorkspaceWithRole = vi.fn();
vi.mock('../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: () => useCurrentWorkspaceWithRole(),
}));

vi.mock('./settings/CredentialsSection', () => ({
  CredentialsSection: () => <div>credenciais</div>,
}));
vi.mock('../components/ModelCatalogSection', () => ({
  ModelCatalogSection: (p: { projectId?: string }) => (
    <div>{p.projectId === undefined ? 'catalogo-sem-projeto' : 'catalogo-com-projeto'}</div>
  ),
}));
vi.mock('../components/CredentialSpendSection', () => ({
  CredentialSpendSection: () => <div>gasto</div>,
}));

const caps = (extra: Record<string, boolean>) => ({
  streaming: true,
  toolCalling: true,
  listModels: false,
  embeddings: false,
  routingPreference: false,
  stickySession: false,
  priceCeiling: false,
  promptCaching: false,
  ...extra,
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProvidersPage />
    </QueryClientProvider>,
  );
}

describe('ProvidersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCurrentWorkspaceWithRole.mockReturnValue({
      data: { workspace: { id: 'w1' }, role: 'owner' },
    });
  });

  it('compõe as quatro partes e itera as chaves das capabilities (provider/chave nova aparece)', async () => {
    listProviderCapabilities.mockResolvedValue([
      { provider: 'openrouter', capabilities: caps({ stickySession: true }) },
      { provider: 'ficticio', capabilities: caps({ stickySession: false }) },
    ]);
    montar();
    expect(await screen.findByText('ficticio')).toBeInTheDocument();
    expect(screen.getByText('stickySession')).toBeInTheDocument();
    expect(screen.getByText('credenciais')).toBeInTheDocument();
    expect(screen.getByText('catalogo-sem-projeto')).toBeInTheDocument();
    expect(screen.getByText('gasto')).toBeInTheDocument();
  });

  it('a capability do teto de preço aparece como coluna e a nota explica o teto', async () => {
    listProviderCapabilities.mockResolvedValue([
      { provider: 'openrouter', capabilities: caps({ priceCeiling: true }) },
    ]);
    montar();
    expect(await screen.findByText('priceCeiling')).toBeInTheDocument();
    expect(screen.getByText(/teto de preço|price ceiling/)).toBeInTheDocument();
  });

  it('quem não é owner não vê o gasto', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({
      data: { workspace: { id: 'w1' }, role: 'maintainer' },
    });
    listProviderCapabilities.mockResolvedValue([]);
    montar();
    expect(await screen.findByText('catalogo-sem-projeto')).toBeInTheDocument();
    expect(screen.queryByText('gasto')).toBeNull();
  });

  it('capabilities falhando mostram erro nomeado', async () => {
    listProviderCapabilities.mockRejectedValue(new Error('boom'));
    montar();
    expect(
      await screen.findByText(/Não foi possível carregar as capacidades|Could not load the provider capabilities/),
    ).toBeInTheDocument();
  });
});

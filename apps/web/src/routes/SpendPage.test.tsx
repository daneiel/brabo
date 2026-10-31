import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../lib/i18n';
import { SpendPage } from './SpendPage';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

const listWorkspaces = vi.fn();
const getWorkspaceSpendReport = vi.fn();
const getMyWorkspaceSpend = vi.fn();
const getCredentialSpend = vi.fn();
const getProjectsSummary = vi.fn();
const listProjects = vi.fn();
const listModelCatalog = vi.fn();

vi.mock('../lib/api-client', () => ({
  listWorkspaces: (...a: unknown[]) => listWorkspaces(...a),
  getWorkspaceSpendReport: (...a: unknown[]) => getWorkspaceSpendReport(...a),
  getMyWorkspaceSpend: (...a: unknown[]) => getMyWorkspaceSpend(...a),
  getCredentialSpend: (...a: unknown[]) => getCredentialSpend(...a),
  getProjectsSummary: (...a: unknown[]) => getProjectsSummary(...a),
  listProjects: (...a: unknown[]) => listProjects(...a),
  listModelCatalog: (...a: unknown[]) => listModelCatalog(...a),
}));
// O link do orçamento precisa de roteador; o teste só confere o texto.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const linha = (chave: string, costMicros: number, extra = {}) => ({
  chave,
  rotulo: null,
  actorKind: null,
  costMicros,
  inputTokens: 10,
  outputTokens: 5,
  chamadas: 2,
  ...extra,
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SpendPage />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listModelCatalog.mockResolvedValue({});
  getCredentialSpend.mockResolvedValue({
    workspaceId: 'ws-1',
    ownerId: 'u',
    meses: 6,
    totalMicros: 0,
    porProvider: [],
  });
  getProjectsSummary.mockResolvedValue([
    { projectId: 'p-1', budget: { limitMicros: 10_000_000, spentMicros: 2_000_000 } },
    { projectId: 'p-2', budget: null },
  ]);
  listProjects.mockResolvedValue([
    { id: 'p-1', name: 'Alfa' },
    { id: 'p-2', name: 'Beta' },
  ]);
});

describe('SpendPage — owner', () => {
  beforeEach(() => {
    listWorkspaces.mockResolvedValue([{ workspace: { id: 'ws-1' }, role: 'owner' }]);
    getWorkspaceSpendReport.mockResolvedValue({
      workspaceId: 'ws-1',
      ownerId: 'u',
      dias: 30,
      totalMicros: 5_000_000,
      assinaturaMicros: 1_000_000,
      inputTokens: 100,
      outputTokens: 50,
      chamadas: 7,
      porModelo: [linha('m', 4_000_000)],
      porProvider: [linha('anthropic', 4_000_000)],
      porProjeto: [linha('p-1', 5_000_000, { rotulo: 'Alfa' })],
      porAtor: [],
      porOwner: [],
      porAgente: [],
      porDia: [],
    });
  });

  it('vê o workspace inteiro, a assinatura separada, a fatura por chave e os orçamentos', async () => {
    montar();

    expect(await screen.findByText('Por provider')).toBeInTheDocument();
    expect(getWorkspaceSpendReport).toHaveBeenCalledWith('ws-1', 30, undefined);
    expect(screen.getByText('Assinatura')).toBeInTheDocument();
    expect(await screen.findByText('Gasto das suas chaves')).toBeInTheDocument();
    expect(await screen.findByText('Orçamentos dos projetos')).toBeInTheDocument();
    expect(await screen.findByText(/sem orçamento — definir/)).toBeInTheDocument();
    expect(getMyWorkspaceSpend).not.toHaveBeenCalled();
  });

  it('erro do relatório tem mensagem e botão', async () => {
    getWorkspaceSpendReport.mockRejectedValue(new Error('500'));
    montar();

    expect(await screen.findByText(/Não consegui carregar o gasto agora/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });
});

describe('SpendPage — não-owner', () => {
  it('vê só o PRÓPRIO consumo por projeto: nunca provider, chave nem a rota do owner', async () => {
    listWorkspaces.mockResolvedValue([{ workspace: { id: 'ws-1' }, role: 'developer' }]);
    getMyWorkspaceSpend.mockResolvedValue({
      workspaceId: 'ws-1',
      dias: 30,
      actorId: 'u2',
      totalMicros: 700,
      inputTokens: 10,
      outputTokens: 5,
      chamadas: 1,
      porProjeto: [linha('p-1', 700, { rotulo: 'Alfa' })],
      porDia: [],
    });
    montar();

    expect(await screen.findByText('O meu consumo')).toBeInTheDocument();
    expect(await screen.findByText('Alfa')).toBeInTheDocument();
    expect(getMyWorkspaceSpend).toHaveBeenCalledWith('ws-1', 30);
    expect(getWorkspaceSpendReport).not.toHaveBeenCalled();
    expect(getCredentialSpend).not.toHaveBeenCalled();
    expect(screen.queryByText('Por provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Gasto das suas chaves')).not.toBeInTheDocument();
  });
});

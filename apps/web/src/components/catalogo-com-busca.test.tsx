/**
 * RN-694 (AT-357): o catálogo tem busca, o card da credencial oferece
 * "Atualizar catálogo" quando o provider não tem modelo nenhum, e o primeiro
 * modelo ativado pode ir ao time inteiro num clique explícito.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ModelCatalogSection } from './ModelCatalogSection';
import { CredentialsSection } from '../routes/settings/CredentialsSection';
import { ToastProvider } from './ui/ToastProvider';
import i18n from '../lib/i18n';
import { AGENT_LIST } from '../lib/agents';
import type { CatalogoPorCategoria, ModelComCuradoria } from '../lib/api-types';

const listModelCatalog = vi.fn();
const setModelsActive = vi.fn();
const syncModelCatalog = vi.fn();
const listCredentials = vi.fn();
const setAgentModelBinding = vi.fn();
const listWorkspaces = vi.fn();

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>(
    '../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    listModelCatalog: (...a: unknown[]) => listModelCatalog(...a),
    setModelsActive: (...a: unknown[]) => setModelsActive(...a),
    syncModelCatalog: (...a: unknown[]) => syncModelCatalog(...a),
    listCredentials: (...a: unknown[]) => listCredentials(...a),
    setModelUses: vi.fn(),
    setAgentModelBinding: (...a: unknown[]) => setAgentModelBinding(...a),
    listWorkspaces: (...a: unknown[]) => listWorkspaces(...a),
    upsertCredential: vi.fn(),
    deleteCredential: vi.fn(),
    testCredential: vi.fn(),
  };
});

function model(over: Partial<ModelComCuradoria> = {}): ModelComCuradoria {
  return {
    id: 'm-1',
    provider: 'openai',
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    inputPricePerMillionMicros: 150_000,
    outputPricePerMillionMicros: 600_000,
    contextWindow: 128_000,
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsVision: false,
    supportsReasoning: false,
    generatesImage: false,
    manualPricing: true,
    isActive: false,
    uses: [],
    freeRoutingAlias: false,
    availability: 'available',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const HAIKU = model({
  id: 'm-haiku',
  provider: 'openrouter',
  name: 'anthropic/claude-haiku-4.5',
  displayName: 'Anthropic: Claude Haiku 4.5',
});
const LLAMA = model({
  id: 'm-llama',
  provider: 'openrouter',
  name: 'meta-llama/llama-3.3-70b-instruct',
  displayName: 'Meta: Llama 3.3 70B',
});

function catalogo(
  porProvider: Record<string, ModelComCuradoria[]>,
): CatalogoPorCategoria {
  return { local: {}, cloud: porProvider } as CatalogoPorCategoria;
}

function papel(role: string) {
  listWorkspaces.mockResolvedValue([
    { workspace: { id: 'ws-1', name: 'W', slug: 'w' }, role },
  ]);
}

function montar(no: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{no}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  listModelCatalog.mockResolvedValue(catalogo({ openrouter: [HAIKU, LLAMA] }));
  setModelsActive.mockResolvedValue([]);
  syncModelCatalog.mockResolvedValue({ porProvider: [] });
  listCredentials.mockResolvedValue([]);
  setAgentModelBinding.mockResolvedValue({});
  papel('owner');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('busca no catálogo (RN-694)', () => {
  it('acha pelo id sem diferenciar maiúsculas e abre o subgrupo do hub sozinho', async () => {
    montar(<ModelCatalogSection workspaceId="ws-1" projectId="p-1" />);
    await screen.findByLabelText('Buscar modelo no catálogo');
    // Sem busca, o subgrupo do hub nasce fechado: a linha não está na tela.
    expect(screen.queryByText('Anthropic: Claude Haiku 4.5')).toBeNull();

    fireEvent.change(screen.getByLabelText('Buscar modelo no catálogo'), {
      target: { value: 'CLAUDE-HAIKU' },
    });

    expect(await screen.findByText('Anthropic: Claude Haiku 4.5')).toBeTruthy();
    expect(screen.queryByText('Meta: Llama 3.3 70B')).toBeNull();
  });

  it('busca sem resultado DIZ que nada casou, com o termo', async () => {
    montar(<ModelCatalogSection workspaceId="ws-1" projectId="p-1" />);
    fireEvent.change(await screen.findByLabelText('Buscar modelo no catálogo'), {
      target: { value: 'gemini' },
    });

    expect(await screen.findByText(/Nenhum modelo do catálogo casa com “gemini”/)).toBeTruthy();
  });
});

describe('ativar e aplicar ao time (RN-694)', () => {
  async function marcarHaiku() {
    fireEvent.change(await screen.findByLabelText('Buscar modelo no catálogo'), {
      target: { value: 'haiku' },
    });
    await screen.findByText('Anthropic: Claude Haiku 4.5');
    fireEvent.click(screen.getByRole('checkbox', { name: /Claude Haiku 4.5/ }));
  }

  it('ativa e aplica a todos os agentes pelos MESMOS endpoints, só com o clique', async () => {
    montar(<ModelCatalogSection workspaceId="ws-1" projectId="p-1" />);
    await marcarHaiku();

    const botao = await screen.findByRole('button', { name: /Ativar e aplicar aos/ });
    // O aviso de sobrescrita da RN-476 vem junto.
    const explicacao = screen.getByText(/obrescreve o modelo próprio de cada agente/);
    // AT-373: a explicação é linha própria e não começa com o "·" solto.
    expect(explicacao.textContent?.startsWith('Sobrescreve')).toBe(true);
    expect(setModelsActive).not.toHaveBeenCalled();
    await waitFor(() => expect(botao).not.toBeDisabled());
    fireEvent.click(botao);

    await waitFor(() =>
      expect(setAgentModelBinding).toHaveBeenCalledTimes(AGENT_LIST.length),
    );
    expect(setModelsActive).toHaveBeenCalledWith('ws-1', {
      modelIds: ['m-haiku'],
      isActive: true,
    });
    expect(setAgentModelBinding).toHaveBeenCalledWith('p-1', AGENT_LIST[0].key, 'm-haiku');
  });

  it('aplicação parcial diz quantas de quantas e nomeia as que ficaram (RN-469)', async () => {
    setAgentModelBinding.mockImplementation((_p: string, chave: string) =>
      chave === AGENT_LIST[1].key ? Promise.reject(new Error('x')) : Promise.resolve({}),
    );
    montar(<ModelCatalogSection workspaceId="ws-1" projectId="p-1" />);
    await marcarHaiku();
    const botao = await screen.findByRole('button', { name: /Ativar e aplicar aos/ });
    await waitFor(() => expect(botao).not.toBeDisabled());
    fireEvent.click(botao);

    expect(
      await screen.findByText(
        new RegExp(`${AGENT_LIST.length - 1} de ${AGENT_LIST.length}`),
      ),
    ).toBeTruthy();
    expect(screen.getByText((t) => t.includes(AGENT_LIST[1].name))).toBeTruthy();
  });

  it('ativação recusada não aplica nada aos agentes', async () => {
    setModelsActive.mockRejectedValue(new Error('recusado'));
    montar(<ModelCatalogSection workspaceId="ws-1" projectId="p-1" />);
    await marcarHaiku();
    const botao = await screen.findByRole('button', { name: /Ativar e aplicar aos/ });
    await waitFor(() => expect(botao).not.toBeDisabled());
    fireEvent.click(botao);

    expect(await screen.findByText('Não foi possível salvar')).toBeTruthy();
    expect(setAgentModelBinding).not.toHaveBeenCalled();
  });

  it('abaixo de owner o caminho fica inerte e diz por quê (RN-102)', async () => {
    papel('maintainer');
    montar(<ModelCatalogSection workspaceId="ws-1" projectId="p-1" />);
    await marcarHaiku();

    expect(await screen.findByText('Só o dono do workspace ativa modelos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ativar e aplicar aos/ })).toBeDisabled();
  });

  it('com algum modelo já ativo, o caminho não é oferecido', async () => {
    listModelCatalog.mockResolvedValue(
      catalogo({ openrouter: [HAIKU, { ...LLAMA, isActive: true }] }),
    );
    montar(<ModelCatalogSection workspaceId="ws-1" projectId="p-1" />);
    await marcarHaiku();

    expect(screen.queryByRole('button', { name: /Ativar e aplicar aos/ })).toBeNull();
  });
});

describe('"Atualizar catálogo" ao lado da credencial (RN-694)', () => {
  function credencial(provider: string) {
    return {
      id: `cred-${provider}`,
      provider,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  it('credencial sem modelo no catálogo ganha o botão, que chama o mesmo sync', async () => {
    listCredentials.mockResolvedValue([credencial('anthropic')]);
    montar(<CredentialsSection />);

    const botao = await screen.findByRole('button', {
      name: 'Atualizar o catálogo de modelos de Anthropic',
    });
    fireEvent.click(botao);

    await waitFor(() => expect(syncModelCatalog).toHaveBeenCalledWith('ws-1'));
    expect(await screen.findByText('Catálogo sincronizado')).toBeTruthy();
  });

  it('credencial cujo provider já tem modelo no catálogo não ganha o botão', async () => {
    listCredentials.mockResolvedValue([credencial('openrouter')]);
    montar(<CredentialsSection />);

    await screen.findByLabelText('Nova chave de OpenRouter');
    await waitFor(() => expect(listModelCatalog).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Atualizar o catálogo/ })).toBeNull();
  });

  it('sync que falha vira toast com o título de falha', async () => {
    listCredentials.mockResolvedValue([credencial('anthropic')]);
    syncModelCatalog.mockRejectedValue(new Error('fora'));
    montar(<CredentialsSection />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Atualizar o catálogo de modelos de Anthropic',
      }),
    );

    expect(await screen.findByText('Sync falhou')).toBeTruthy();
  });
});

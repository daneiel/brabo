import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelCatalogSection } from './ModelCatalogSection';
import { ToastProvider } from './ui/ToastProvider';
import type {
  CatalogoPorCategoria,
  ModelComCuradoria,
} from '../lib/api-types';

const listModelCatalog = vi.fn();
const setModelsActive = vi.fn();
const syncModelCatalog = vi.fn();

vi.mock('../lib/api-client', () => ({
  listModelCatalog: (...args: unknown[]) => listModelCatalog(...args),
  setModelsActive: (...args: unknown[]) => setModelsActive(...args),
  syncModelCatalog: (...args: unknown[]) => syncModelCatalog(...args),
}));

function model(
  over: Partial<ModelComCuradoria> = {},
): ModelComCuradoria {
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
    manualPricing: true,
    isActive: false,
    availability: 'available',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function catalogo(modelos: ModelComCuradoria[]): CatalogoPorCategoria {
  return { local: {}, cloud: { openai: modelos } } as CatalogoPorCategoria;
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ModelCatalogSection workspaceId="ws-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listModelCatalog.mockResolvedValue(catalogo([model()]));
  setModelsActive.mockResolvedValue([]);
  syncModelCatalog.mockResolvedValue({ porProvider: [] });
});

describe('ModelCatalogSection', () => {
  it('mostra o modelo descoberto como DESATIVADO — ativar é do owner (RN-043)', async () => {
    montar();

    expect(await screen.findByText('GPT-4o mini')).toBeTruthy();
    expect(screen.getByText('desativado')).toBeTruthy();
  });

  it('ativa em lote o que foi marcado', async () => {
    montar();
    await screen.findByText('GPT-4o mini');

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));

    await waitFor(() =>
      expect(setModelsActive).toHaveBeenCalledWith('ws-1', {
        modelIds: ['m-1'],
        isActive: true,
      }),
    );
  });

  it('modelo indisponível continua listado, marcado', async () => {
    listModelCatalog.mockResolvedValue(
      catalogo([model({ availability: 'unavailable', isActive: true })]),
    );
    montar();

    expect(await screen.findByText('GPT-4o mini')).toBeTruthy();
    expect(screen.getByText('indisponível no provider')).toBeTruthy();
    // Continua ativo: os dois eixos são independentes.
    expect(screen.getByText('ativo')).toBeTruthy();
  });

  it('o relatório do sync mostra TODO provider, inclusive o pulado, com a origem', async () => {
    syncModelCatalog.mockResolvedValue({
      porProvider: [
        {
          provider: 'openai',
          descobertos: 2,
          reencontrados: 0,
          indisponibilizados: 1,
        },
        {
          provider: 'anthropic',
          descobertos: 0,
          reencontrados: 0,
          indisponibilizados: 0,
          pulado: 'sem_capability',
        },
        {
          provider: 'ollama',
          descobertos: 0,
          reencontrados: 0,
          indisponibilizados: 0,
          pulado: 'falha',
          origemDaFalha: 'infra',
        },
      ],
    });
    montar();
    await screen.findByText('GPT-4o mini');

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar catálogo' }));

    expect(await screen.findByText(/2 novo\(s\)/)).toBeTruthy();
    expect(screen.getByText('sem listagem de catálogo')).toBeTruthy();
    // "Falhou" sem a origem seria diagnóstico por eliminação (ADR 0020).
    expect(screen.getByText('falhou · origem infra')).toBeTruthy();
  });

  it('catálogo vazio explica o que fazer em vez de mostrar nada', async () => {
    listModelCatalog.mockResolvedValue(catalogo([]));
    montar();

    expect(
      await screen.findByText(/Cadastre uma credencial de provider/),
    ).toBeTruthy();
  });
});

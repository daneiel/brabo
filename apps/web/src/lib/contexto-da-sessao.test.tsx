import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const getSessionContextSummary = vi.fn();
vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  getSessionContextSummary: (...a: unknown[]) => getSessionContextSummary(...a),
}));

const { useContextoDaSessaoInteira } = await import('./contexto-da-sessao');
const { criarInvalidadorDoCanal } = await import('./canal-vivo');

function montar(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useContextoDaSessaoInteira('p1', 's1', 'v1'), { wrapper });
}

describe('RN-847 (AT-518): o resumo do contexto é relido sem remontar', () => {
  it('o merge que chega pelo canal relê o resumo', async () => {
    getSessionContextSummary.mockReset().mockResolvedValue({});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    montar(client);
    await waitFor(() => expect(getSessionContextSummary).toHaveBeenCalledTimes(1));
    const invalidador = criarInvalidadorDoCanal(client, 'p1', 's1');
    invalidador.aoEvento('action.git_merge', false);
    await waitFor(() => expect(getSessionContextSummary).toHaveBeenCalledTimes(2));
    invalidador.encerrar();
  });

  it('CASO DE FALHA: evento que não mexe em PR não relê o resumo', async () => {
    getSessionContextSummary.mockReset().mockResolvedValue({});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    montar(client);
    await waitFor(() => expect(getSessionContextSummary).toHaveBeenCalledTimes(1));
    const invalidador = criarInvalidadorDoCanal(client, 'p1', 's1');
    invalidador.aoEvento('tool.call', false);
    await new Promise((r) => setTimeout(r, 20));
    expect(getSessionContextSummary).toHaveBeenCalledTimes(1);
    invalidador.encerrar();
  });
});

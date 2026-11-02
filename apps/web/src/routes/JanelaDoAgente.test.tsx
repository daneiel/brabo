import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import JanelaDoAgente from './JanelaDoAgente';

const getSessionTokenUsage = vi.fn();
vi.mock('../lib/api-client', () => ({
  getSessionTokenUsage: (...a: unknown[]) => getSessionTokenUsage(...a),
}));

describe('JanelaDoAgente', () => {
  it('com o cache preenchido, montar não chama o queryFn de novo', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['session-token-usage', 'p1', 's1'], [
      { actorId: 'criativo', lastCall: { inputTokens: 10, contextWindow: 100, modelName: 'm' } },
    ]);
    render(
      <QueryClientProvider client={qc}>
        <JanelaDoAgente projectId="p1" sessionId="s1" agente="criativo" />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(getSessionTokenUsage).not.toHaveBeenCalled();
    expect(screen.queryByText(/10/)).not.toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';

/**
 * AT-302 — o `/status` passa pelo `pollQueParaNoErro`.
 *
 * Um serviço que RESPONDE (inclusive com 5xx, que `fetchHealth` devolve como
 * `status: 'error'` num corpo resolvido) continua sendo acompanhado a cada 5 s.
 * Um serviço que NÃO responde (a busca rejeita) deixava a página batendo nele
 * para sempre; agora o poll para até o foco da janela ou a remontagem.
 */

const fetchHealth = vi.fn();

vi.mock('../lib/health', () => ({
  API_URL: 'http://api.test',
  ENGINE_URL: 'http://engine.test',
  fetchHealth: (url: string) => fetchHealth(url),
}));

const { StatusPage } = await import('./StatusPage');

function chamadasPara(url: string) {
  return fetchHealth.mock.calls.filter(([u]) => u === url).length;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchHealth.mockReset();
  fetchHealth.mockImplementation((url: string) =>
    url === 'http://api.test'
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve({ service: 'engine', status: 'ok', timestamp: '2026-09-30T00:00:00Z' }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StatusPage — poll que para no erro (AT-302)', () => {
  it('o serviço que responde segue acompanhado; o que não responde para de ser martelado', async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <StatusPage irPara={() => {}} voltarPara="/login" />
      </QueryClientProvider>,
    );
    await screen.findByText('2026-09-30T00:00:00Z');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });

    // Caminho feliz: o engine respondeu e foi perguntado de novo a cada 5 s.
    expect(chamadasPara('http://engine.test')).toBeGreaterThanOrEqual(4);
    // Falha: a api não respondeu UMA vez, e ninguém insistiu por timer.
    expect(chamadasPara('http://api.test')).toBe(1);
  });
});

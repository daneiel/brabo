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
const { default: i18n } = await import('../lib/i18n');

function instante(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
}

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
    await screen.findByText(instante('2026-09-30T00:00:00Z'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });

    // Caminho feliz: o engine respondeu e foi perguntado de novo a cada 5 s.
    expect(chamadasPara('http://engine.test')).toBeGreaterThanOrEqual(4);
    // Falha: a api não respondeu UMA vez, e ninguém insistiu por timer.
    expect(chamadasPara('http://api.test')).toBe(1);
  });
});

describe('StatusPage — data e rótulos na língua de quem lê (AT-327)', () => {
  it('o instante sai formatado, nunca o ISO cru, e o estado é palavra, não enum', async () => {
    await i18n.changeLanguage('pt-BR');
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <StatusPage irPara={() => {}} voltarPara="/login" />
      </QueryClientProvider>,
    );
    await screen.findByText(instante('2026-09-30T00:00:00Z'));
    expect(screen.queryByText('2026-09-30T00:00:00Z')).toBeNull();
    expect(screen.getByText('Última verificação')).toBeInTheDocument();
    expect(screen.getByText('no ar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
  });

  it('caso de falha: instante inválido ou ausente diz "não informado", nunca "Invalid Date"', async () => {
    await i18n.changeLanguage('pt-BR');
    fetchHealth.mockImplementation((url: string) =>
      Promise.resolve({
        service: url,
        status: 'ok',
        timestamp: url === 'http://api.test' ? 'lixo' : undefined,
      }),
    );
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <StatusPage irPara={() => {}} voltarPara="/login" />
      </QueryClientProvider>,
    );
    expect(await screen.findAllByText('não informado')).toHaveLength(2);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});

/**
 * AT-330 (achado N5 da auditoria da Rodada 29): em 390px o `/status` era a
 * única página que rolava de lado (413px de conteúdo). A tabela mora num
 * invólucro que rola por DENTRO, e as células quebram texto longo.
 */
describe('StatusPage — layout estreito (AT-330)', () => {
  it('a tabela fica num invólucro que rola por dentro, e quebra texto longo em vez de alargar', async () => {
    await i18n.changeLanguage('pt-BR');
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <StatusPage irPara={() => {}} voltarPara="/login" />
      </QueryClientProvider>,
    );
    await screen.findByText(instante('2026-09-30T00:00:00Z'));

    const rolagem = screen.getByTestId('rolagem-da-tabela-de-status');
    expect(rolagem.style.overflowX).toBe('auto');
    expect(rolagem.style.maxWidth).toBe('100%');
    const tabela = screen.getByRole('table');
    expect(rolagem).toContainElement(tabela);
    expect(tabela.style.overflowWrap).toBe('anywhere');
  });

  it('caso de falha: com um serviço fora, a linha de erro continua dentro do mesmo invólucro', async () => {
    await i18n.changeLanguage('pt-BR');
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <StatusPage irPara={() => {}} voltarPara="/login" />
      </QueryClientProvider>,
    );
    const rolagem = screen.getByTestId('rolagem-da-tabela-de-status');
    const erro = await screen.findByText('fora do ar');
    expect(rolagem).toContainElement(erro);
  });
});

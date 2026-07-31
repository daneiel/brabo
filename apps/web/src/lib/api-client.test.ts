import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, listWorkspaces } from './api-client';

/**
 * A correlação das chamadas à api (ADR 0035).
 *
 * Duas regressões, as duas silenciosas:
 *
 * 1. **A retentativa depois do 401 reusava o mesmo `traceparent`.** As duas
 *    tentativas chegavam à api declarando o mesmo `span_id` como pai, e o Tempo
 *    as colapsava num nó só. O fato que interessa — houve um refresh no meio, e a
 *    primeira tentativa falhou — desaparecia do desenho.
 * 2. **Falha de rede não era logada aqui.** DNS, offline, CORS e api fora do ar
 *    rejeitam o `fetch`, o que escapava do `if (!res.ok)`. O erro subia até o
 *    `QueryCache.onError` do `main.tsx` sem `trace_id`, sem rota e sem duração —
 *    ou seja, o modo de falha mais comum em desenvolvimento era o menos
 *    diagnosticável.
 */

function traceparentsDe(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .filter(([url]) => !String(url).includes('/auth/'))
    .map(([, init]) => {
      const headers = (init as RequestInit).headers as Record<string, string>;
      return headers.traceparent;
    });
}

function json(status: number, corpo: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corpo),
  } as unknown as Response;
}

describe('api-client', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retentativa após 401 mantém a trace e troca a span', async () => {
    const fetchSpy = vi.fn((url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve(json(200, { accessToken: 'token-novo' }));
      }
      // Primeira chamada de domínio 401; a seguinte, 200.
      const dominio = traceparentsDe({ mock: fetchSpy.mock }).length;
      return Promise.resolve(dominio <= 1 ? json(401) : json(200, { ok: true }));
    });
    vi.stubGlobal('fetch', fetchSpy);

    await listWorkspaces();

    const traceparents = traceparentsDe(fetchSpy);
    expect(traceparents).toHaveLength(2);

    const [primeiro, segundo] = traceparents.map((tp) => tp.split('-'));
    // Mesma trace...
    expect(segundo[1]).toBe(primeiro[1]);
    // ...span diferente. Era isto que faltava.
    expect(segundo[2]).not.toBe(primeiro[2]);
  });

  it('erro de status loga com trace_id e levanta ApiError com o mesmo id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(500, { erro: 'x' })));

    const falha = await listWorkspaces().catch((e: unknown) => e);

    expect(falha).toBeInstanceOf(ApiError);

    const spy = console.error as unknown as { mock: { calls: string[][] } };
    const linha = JSON.parse(spy.mock.calls[0][0]) as Record<string, unknown>;
    expect(linha.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(linha.status).toBe(500);
    expect(typeof linha.duration_ms).toBe('number');
    // O id da exceção e o da linha de log têm que ser o MESMO: é ele que leva do
    // erro na tela ao span de servidor.
    expect((falha as ApiError).traceId).toBe(linha.trace_id);
  });

  it('falha de rede é logada antes de subir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const falha = await listWorkspaces().catch((e: unknown) => e);

    expect(falha).toBeInstanceOf(Error);
    expect(falha).not.toBeInstanceOf(ApiError);

    const spy = console.error as unknown as { mock: { calls: string[][] } };
    const linha = JSON.parse(spy.mock.calls[0][0]) as Record<string, unknown>;
    expect(linha.message).toContain('inalcançável');
    expect(linha.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(linha.erro).toBe('offline');
  });
});

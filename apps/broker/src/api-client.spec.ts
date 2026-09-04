import { describe, expect, it } from 'vitest';
import {
  ApiIndisponivelError,
  CABECALHO_SERVICE_TOKEN,
  criarBuscadorDeContexto,
  garantirIdDeProjeto,
  IdDeProjetoInvalidoError,
  ProjetoDesconhecidoError,
} from './api-client.ts';
import { lerConfiguracao } from './config.ts';

const CONFIG = lerConfiguracao({
  API_URL: 'http://api:3000',
  BRABO_SERVICE_TOKEN: 'segredo-de-teste-16',
});

function respostaFalsa(
  status: number,
  corpo: unknown,
): { chamadas: Array<{ url: string; init: RequestInit | undefined }>; buscar: typeof fetch } {
  const chamadas: Array<{ url: string; init: RequestInit | undefined }> = [];
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
    } as Response;
  }) as unknown as typeof fetch;
  return { chamadas, buscar };
}

describe('criarBuscadorDeContexto', () => {
  it('lê o contexto na rota interna, com o token de serviço no cabeçalho', async () => {
    const { chamadas, buscar } = respostaFalsa(200, { projectId: 'p' });
    const buscarContexto = criarBuscadorDeContexto(CONFIG, buscar);

    await buscarContexto('f52be111');

    expect(chamadas[0]?.url).toBe(
      'http://api:3000/internal/projects/f52be111/container-spec',
    );
    const headers = chamadas[0]?.init?.headers as Record<string, string>;
    expect(headers[CABECALHO_SERVICE_TOKEN]).toBe('segredo-de-teste-16');
  });

  it('404 vira `ProjetoDesconhecidoError` — o conserto é outro', async () => {
    const { buscar } = respostaFalsa(404, {});

    await expect(criarBuscadorDeContexto(CONFIG, buscar)('p')).rejects.toBeInstanceOf(
      ProjetoDesconhecidoError,
    );
  });

  it('qualquer outro status vira `ApiIndisponivelError`, origem infra', async () => {
    const { buscar } = respostaFalsa(500, {});

    const erro = await capturar(() => criarBuscadorDeContexto(CONFIG, buscar)('p'));

    expect(erro).toBeInstanceOf(ApiIndisponivelError);
    expect((erro as ApiIndisponivelError).origem).toBe('infra');
    expect(erro?.message).toContain('Nenhum container foi tocado');
  });

  it('falha de transporte também vira `ApiIndisponivelError`', async () => {
    const buscar = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(criarBuscadorDeContexto(CONFIG, buscar)('p')).rejects.toBeInstanceOf(
      ApiIndisponivelError,
    );
  });

  it('recusa projectId que não é segmento de URL ANTES de chamar a api', async () => {
    const { chamadas, buscar } = respostaFalsa(200, {});

    await expect(
      criarBuscadorDeContexto(CONFIG, buscar)('../internal/gates'),
    ).rejects.toBeInstanceOf(IdDeProjetoInvalidoError);
    // A validação é antes da montagem da URL: interpolar e depois conferir
    // seria conferir um caminho já montado (RN-128).
    expect(chamadas).toHaveLength(0);
  });
});

describe('garantirIdDeProjeto', () => {
  it('aceita uuid e slug de agente; recusa barra, ponto-ponto e vazio', () => {
    expect(garantirIdDeProjeto('f52be111-0000-4000-8000-000000000000')).toBeTruthy();
    expect(garantirIdDeProjeto('dev_frontend-2')).toBeTruthy();
    for (const ruim of ['a/b', '..', '', 'a b', 'x'.repeat(65)]) {
      expect(() => garantirIdDeProjeto(ruim)).toThrow(IdDeProjetoInvalidoError);
    }
  });
});

async function capturar(f: () => Promise<unknown>): Promise<Error | undefined> {
  try {
    await f();
    return undefined;
  } catch (erro) {
    return erro as Error;
  }
}

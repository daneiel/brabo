import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renovarSessao, temSessao, tokenAtual, sair } from './auth';

/**
 * A sessão da web, com foco no single-flight (Fase 7a — o corte).
 *
 * O teste que importa aqui é o do refresh concorrente. Não é sobre
 * performance: o refresh ROTACIONA, e duas renovações em paralelo fazem a
 * segunda apresentar um token que a primeira já consumiu — que do lado do
 * servidor é indistinguível de um roubo. A família é revogada e o usuário é
 * deslogado por ter duas abas abertas.
 *
 * O ADR 0031 registrou o single-flight como requisito desta fase justamente
 * porque o servidor não tem como resolver: lá, duplo-submit e replay de
 * ladrão são byte a byte iguais.
 */

const respostaOk = (token: string) =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ accessToken: token, expiresIn: 900 }),
  }) as Response;

const resposta401 = () => ({ ok: false, status: 401 }) as Response;

beforeEach(async () => {
  vi.restoreAllMocks();
  document.cookie = 'brabo_csrf=token-csrf';
  // Zera a sessão entre os testes: o módulo guarda estado.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta401()));
  await sair();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renovação de sessão', () => {
  it('caminho feliz: guarda o access token devolvido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaOk('token-novo')));

    await expect(renovarSessao()).resolves.toBe('token-novo');
    expect(tokenAtual()).toBe('token-novo');
    expect(temSessao()).toBe(true);
  });

  it('401 limpa a sessão em vez de manter o token velho', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaOk('t1')));
    await renovarSessao();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resposta401()));
    await expect(renovarSessao()).resolves.toBeNull();

    expect(temSessao()).toBe(false);
  });

  it('erro de rede não deixa a sessão num estado ambíguo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('rede caiu')),
    );

    await expect(renovarSessao()).resolves.toBeNull();
    expect(temSessao()).toBe(false);
  });

  describe('single-flight', () => {
    it('N chamadas concorrentes fazem UMA requisição só', async () => {
      // O teste central. Sem o single-flight, seriam cinco POSTs em
      // /auth/refresh, o segundo apresentaria um token já rotacionado, a
      // família seria revogada por reuso e o usuário deslogado — por abrir
      // cinco requisições ao mesmo tempo, que é o uso normal de uma SPA.
      const espiao = vi.fn().mockResolvedValue(respostaOk('token-unico'));
      vi.stubGlobal('fetch', espiao);

      const resultados = await Promise.all([
        renovarSessao(),
        renovarSessao(),
        renovarSessao(),
        renovarSessao(),
        renovarSessao(),
      ]);

      expect(espiao).toHaveBeenCalledTimes(1);
      expect(resultados).toEqual(Array(5).fill('token-unico'));
    });

    it('depois que a renovação termina, a próxima acontece de verdade', async () => {
      // A outra metade: zerar a promessa no `finally`. Sem isso o
      // single-flight vira "renova uma vez só, para sempre", e a sessão morre
      // 15 minutos depois sem chance de recuperação.
      const espiao = vi.fn().mockResolvedValue(respostaOk('t'));
      vi.stubGlobal('fetch', espiao);

      await renovarSessao();
      await renovarSessao();

      expect(espiao).toHaveBeenCalledTimes(2);
    });

    it('a falha também libera o voo seguinte', async () => {
      const espiao = vi.fn().mockResolvedValue(resposta401());
      vi.stubGlobal('fetch', espiao);

      await renovarSessao();
      await renovarSessao();

      expect(espiao).toHaveBeenCalledTimes(2);
    });
  });

  it('manda credentials: include — sem isso o cookie não viaja', async () => {
    // A web e a api estão em origens diferentes em desenvolvimento. Sem
    // `include`, o browser não anexa o cookie e o refresh falha — só que
    // funcionaria num ambiente de origem única, que é a pior forma de
    // descobrir o erro.
    const espiao = vi.fn().mockResolvedValue(respostaOk('t'));
    vi.stubGlobal('fetch', espiao);

    await renovarSessao();

    const [, opcoes] = espiao.mock.calls[0] as [string, RequestInit];
    expect(opcoes.credentials).toBe('include');
  });

  it('ecoa o cookie de CSRF no cabeçalho', async () => {
    const espiao = vi.fn().mockResolvedValue(respostaOk('t'));
    vi.stubGlobal('fetch', espiao);

    await renovarSessao();

    const [, opcoes] = espiao.mock.calls[0] as [string, RequestInit];
    expect((opcoes.headers as Record<string, string>)['X-CSRF-Token']).toBe(
      'token-csrf',
    );
  });
});

describe('sair', () => {
  it('limpa a sessão local mesmo se a api falhar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaOk('t')));
    await renovarSessao();
    expect(temSessao()).toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('api fora')));
    await sair();

    // O usuário pediu para sair. Uma api fora do ar não pode ser motivo para
    // ele continuar vendo a aplicação logada.
    expect(temSessao()).toBe(false);
  });
});

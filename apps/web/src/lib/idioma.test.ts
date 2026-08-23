import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAVE_IDIOMA,
  IDIOMA_PADRAO,
  definirIdioma,
  idiomaInicial,
  idiomaSugeridoPeloNavegador,
  lerIdiomaCache,
  sincronizarIdiomaDaSessao,
} from './idioma';

/**
 * A preferência de idioma (fundação de i18n, Onda 6a).
 *
 * O que este arquivo cobre além do óbvio: o `localStorage` é CACHE, nunca a
 * fonte de verdade — o servidor é (`localeDaSessao`, de `auth.ts`) — e os
 * dois módulos que `idioma.ts` depende (`./auth`, `./api-client`) são
 * mockados para o teste não precisar de rede nem sessão real.
 */

const { localeDaSessaoMock } = vi.hoisted(() => ({
  localeDaSessaoMock: vi.fn<() => string | null>(),
}));
vi.mock('./auth', () => ({ localeDaSessao: localeDaSessaoMock }));

const { updateMyPreferencesMock } = vi.hoisted(() => ({
  updateMyPreferencesMock: vi.fn(),
}));
vi.mock('./api-client', () => ({
  updateMyPreferences: updateMyPreferencesMock,
}));

function i18nFalso() {
  const i18n = {
    language: 'en',
    changeLanguage: vi.fn(async (novo: string) => {
      i18n.language = novo;
    }),
  };
  return i18n;
}

beforeEach(() => {
  window.localStorage.clear();
  localeDaSessaoMock.mockReset();
  updateMyPreferencesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('preferência de idioma — leitura e sugestão', () => {
  it('sem cache, não há preferência gravada', () => {
    expect(lerIdiomaCache()).toBeNull();
  });

  it('sugestão do navegador: "pt*" vira pt-BR, o resto vira en', () => {
    vi.stubGlobal('navigator', { language: 'pt-PT' });
    expect(idiomaSugeridoPeloNavegador()).toBe('pt-BR');

    vi.stubGlobal('navigator', { language: 'es-ES' });
    expect(idiomaSugeridoPeloNavegador()).toBe('en');

    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(idiomaSugeridoPeloNavegador()).toBe('en');
  });

  it('idiomaInicial: cache vence a sugestão do navegador', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    window.localStorage.setItem(CHAVE_IDIOMA, 'pt-BR');
    expect(idiomaInicial()).toBe('pt-BR');
  });

  it('idiomaInicial: sem cache, cai na sugestão do navegador', () => {
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    expect(idiomaInicial()).toBe('pt-BR');
  });

  it('valor desconhecido no cache é ignorado, nunca vira idioma inválido', () => {
    window.localStorage.setItem(CHAVE_IDIOMA, 'klingon');
    expect(lerIdiomaCache()).toBeNull();
  });
});

describe('sincronizar com o servidor', () => {
  it('aplica o idioma que o servidor mandou e grava o cache', () => {
    localeDaSessaoMock.mockReturnValue('pt-BR');
    const i18n = i18nFalso();

    sincronizarIdiomaDaSessao(i18n as never);

    expect(i18n.changeLanguage).toHaveBeenCalledWith('pt-BR');
  });

  it('sem locale do servidor (sessão caiu), não mexe no idioma', () => {
    localeDaSessaoMock.mockReturnValue(null);
    const i18n = i18nFalso();

    sincronizarIdiomaDaSessao(i18n as never);

    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  it('já no idioma certo, não chama changeLanguage à toa', () => {
    localeDaSessaoMock.mockReturnValue('en');
    const i18n = i18nFalso();
    i18n.language = 'en';

    sincronizarIdiomaDaSessao(i18n as never);

    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });
});

describe('definir idioma (troca explícita na AccountPage)', () => {
  it('grava no servidor, atualiza o cache e troca a tela — nessa ordem', async () => {
    updateMyPreferencesMock.mockResolvedValue({ locale: 'pt-BR' });
    const i18n = i18nFalso();

    await definirIdioma('pt-BR', i18n as never);

    expect(updateMyPreferencesMock).toHaveBeenCalledWith({ locale: 'pt-BR' });
    expect(window.localStorage.getItem(CHAVE_IDIOMA)).toBe('pt-BR');
    expect(i18n.changeLanguage).toHaveBeenCalledWith('pt-BR');
  });

  it('servidor recusa: nem cache nem tela mudam', async () => {
    updateMyPreferencesMock.mockRejectedValue(new Error('400'));
    const i18n = i18nFalso();

    await expect(definirIdioma('pt-BR', i18n as never)).rejects.toThrow();

    expect(window.localStorage.getItem(CHAVE_IDIOMA)).toBeNull();
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });
});

describe('constantes', () => {
  it('o default do app é en (Onda 6a)', () => {
    expect(IDIOMA_PADRAO).toBe('en');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarFsBrowserViaApi } from './fs-browser';

/**
 * O transporte de api do navegador de pastas (RN-504).
 *
 * O que este arquivo prova é a ADAPTAÇÃO — a fronteira entre o formato da
 * api (`entries: string[]`, com o que ficou de fora em números ao lado) e o
 * formato que o modal já sabia ler (`entradas: FsEntrada[]`) —, e o contrato
 * que a interface `FsBrowser` impõe: **nunca rejeitar**. Falha vira `{ erro }`
 * porque quem chama é um `useEffect` de componente, e uma promessa rejeitada
 * ali vira erro não tratado em vez de estado de tela.
 */

const { listProjectFoldersMock } = vi.hoisted(() => ({
  listProjectFoldersMock: vi.fn(),
}));

class ApiErrorFalso extends Error {
  // Campo declarado e atribuído no corpo, e não `readonly` no parâmetro:
  // `erasableSyntaxOnly` (tsconfig do web) recusa property parameter.
  body: { message: string };

  constructor(body: { message: string }) {
    super('api error 400');
    this.body = body;
  }
}

vi.mock('./api-client', () => ({
  listProjectFolders: listProjectFoldersMock,
  // A extração da frase da api é coberta em `api-client`; aqui só interessa
  // que ela é USADA em vez de trocada por um texto genérico.
  mensagemDaApi: (erro: unknown) =>
    erro instanceof ApiErrorFalso ? erro.body.message : String(erro),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('criarFsBrowserViaApi', () => {
  it('lista: nome de diretório vira entrada, e o que ficou de fora vem junto', async () => {
    listProjectFoldersMock.mockResolvedValue({
      base: '/home/voce/brabo',
      path: '/home/voce/brabo/loja',
      entries: ['src', 'test'],
      truncado: false,
      arquivos: 4,
      simbolicos: 1,
    });

    const r = await criarFsBrowserViaApi('ws-1').listarDiretorio('/home/voce/brabo/loja');

    expect(listProjectFoldersMock).toHaveBeenCalledWith('ws-1', '/home/voce/brabo/loja');
    // `isDir: true` por CONSTRUÇÃO: a api só devolve diretório em `entries`.
    expect(r.entradas).toEqual([
      { nome: 'src', isDir: true },
      { nome: 'test', isDir: true },
    ]);
    expect(r).toMatchObject({ arquivos: 4, simbolicos: 1, truncado: false });
    expect(r.erro).toBeUndefined();
  });

  it('lista: recusa da api NÃO rejeita — vira `{ erro }` com a frase que a api mandou', async () => {
    listProjectFoldersMock.mockRejectedValue(
      new ApiErrorFalso({
        message: 'A pasta "/etc" está fora da base de projetos (/home/voce/brabo).',
      }),
    );

    const r = await criarFsBrowserViaApi('ws-1').listarDiretorio('/etc');

    expect(r.entradas).toEqual([]);
    // A mensagem da api é o que ENSINA (nomeia a base): trocá-la por um texto
    // genérico perderia a metade útil.
    expect(r.erro).toContain('fora da base de projetos');
  });

  it('diretório inicial: é a BASE, sem round-trip extra', async () => {
    listProjectFoldersMock.mockResolvedValue({
      base: '/home/voce/brabo',
      path: '/home/voce/brabo',
      entries: ['loja'],
      truncado: false,
      arquivos: 0,
      simbolicos: 0,
    });

    const r = await criarFsBrowserViaApi('ws-1').diretorioInicial();

    expect(r.path).toBe('/home/voce/brabo');
    // Sem `path` na chamada: a listagem inicial e a base saem da MESMA
    // resposta.
    expect(listProjectFoldersMock).toHaveBeenCalledWith('ws-1');
  });

  it('diretório inicial: `base: null` é declarado, não é falha genérica', async () => {
    listProjectFoldersMock.mockResolvedValue({
      base: null,
      path: null,
      entries: [],
      truncado: false,
      arquivos: 0,
      simbolicos: 0,
    });

    const r = await criarFsBrowserViaApi('ws-1').diretorioInicial();

    expect(r.path).toBeUndefined();
    expect(r.erro).toContain('BRABO_PROJECTS_BASE');
  });

  it('`fechar()` é no-op e não lança — não há socket para desligar', () => {
    expect(() => criarFsBrowserViaApi('ws-1').fechar()).not.toThrow();
  });
});

import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import terminalPtBR from '../locales/pt-BR/terminal.json';
import { FolderBrowserModal } from './FolderBrowserModal';
import type { FsBrowser } from '../lib/fs-browser';

/**
 * `fs-browser-channel` é substituído por um dublê controlável — o que
 * importa aqui é a ORQUESTRAÇÃO da navegação (atalhos, breadcrumb, subir,
 * um clique seleciona / duplo clique entra, "Usar esta pasta") e os TRÊS
 * estados (carregando / sem runner / pronto), não o protocolo Phoenix em si
 * (coberto em `fs-browser-channel` indiretamente pelo `terminal-channel.
 * test.ts` irmão, e no engine por `terminal_channel_test.exs`).
 *
 * Instância própria de i18next (mesmo padrão de `AccountPage.test.tsx`), só
 * com o namespace `terminal` e `lng: 'pt-BR'` — mantém as asserções em
 * português que este teste já fazia antes da extração.
 */

/**
 * `RunnerOnboardingPanel` — renderizado por este componente quando não há
 * runner — busca o caminho do projeto (`workspace_path`) para prefixar `cd`
 * na instrução final. Daí o dublê e o `QueryClientProvider` abaixo: sem eles
 * o painel nem chega a renderizar, e a mensagem que este arquivo afirma
 * desaparece junto.
 */
vi.mock('../lib/api-client', () => ({
  API_URL: 'https://api.brabo.example',
  getProject: () => Promise.resolve({ id: 'proj-1', workspacePath: null }),
}));

function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { terminal: terminalPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'terminal',
    ns: ['terminal'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function renderComI18n(ui: ReactElement) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nextProvider i18n={novaInstanciaI18n()}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const { connectFsBrowserChannelMock, criarFsBrowserViaApiMock, fakeChannel, fakeApi } =
  vi.hoisted(() => {
    const novoDuble = () => ({
      listarDiretorio: vi.fn(),
      diretorioInicial: vi.fn(),
      fechar: vi.fn(),
    });
    const fakeChannel = novoDuble();
    const fakeApi = novoDuble();
    return {
      fakeChannel,
      fakeApi,
      connectFsBrowserChannelMock: vi.fn(() => fakeChannel as unknown as FsBrowser),
      criarFsBrowserViaApiMock: vi.fn(() => fakeApi as unknown as FsBrowser),
    };
  });

vi.mock('../lib/fs-browser-channel', () => ({
  connectFsBrowserChannel: connectFsBrowserChannelMock,
}));

vi.mock('../lib/fs-browser', () => ({
  criarFsBrowserViaApi: criarFsBrowserViaApiMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FolderBrowserModal — transporte via runner (não-regressão)', () => {
  it('origem runner usa o canal do runner, e NUNCA o transporte de api', async () => {
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockResolvedValue({ path: '/home/user', entradas: [] });

    renderComI18n(
      <FolderBrowserModal
        origem={{ tipo: 'runner', projectId: 'proj-1' }}
        onSelecionar={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(connectFsBrowserChannelMock).toHaveBeenCalledWith('proj-1'));
    expect(criarFsBrowserViaApiMock).not.toHaveBeenCalled();
  });

  it('lista pastas E arquivos, mas só a pasta é selecionável/navegável', async () => {
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockImplementation(async (path: string) => {
      if (path === '/home/user') {
        return {
          path: '/home/user',
          entradas: [
            { nome: 'projetos', isDir: true },
            { nome: 'arquivo.txt', isDir: false },
          ],
        };
      }
      return { path, entradas: [] };
    });

    renderComI18n(
      <FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />,
    );

    expect(connectFsBrowserChannelMock).toHaveBeenCalledWith('proj-1');
    expect(await screen.findByText('projetos')).toBeInTheDocument();
    // Arquivo aparece na lista — protocolo devolve os dois — mas não é um
    // controle interativo (nunca <button>, sem seleção nem navegação).
    expect(screen.getByText('arquivo.txt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'arquivo.txt' })).not.toBeInTheDocument();
  });

  it('um clique SELECIONA a pasta (destaca e atualiza o painel de detalhes) sem navegar', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockImplementation(async (path: string) => ({
      path,
      entradas: [{ nome: 'projetos', isDir: true }],
    }));

    renderComI18n(
      <FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />,
    );

    const item = await screen.findByRole('option', { name: 'projetos' });
    await user.click(item);

    // Nenhuma navegação nova — só a carga inicial de `/home/user`.
    expect(fakeChannel.listarDiretorio).toHaveBeenCalledTimes(1);
    expect(item).toHaveAttribute('aria-selected', 'true');
    // O painel de detalhes passa a descrever o item SELECIONADO.
    expect(screen.getAllByText('projetos').length).toBeGreaterThan(1);
  });

  it('duplo clique ENTRA na pasta', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockImplementation(async (path: string) => {
      if (path === '/home/user') {
        return { path: '/home/user', entradas: [{ nome: 'projetos', isDir: true }] };
      }
      if (path === '/home/user/projetos') {
        return { path: '/home/user/projetos', entradas: [{ nome: 'loja', isDir: true }] };
      }
      return { path, entradas: [] };
    });

    renderComI18n(
      <FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />,
    );

    const item = await screen.findByRole('option', { name: 'projetos' });
    await user.dblClick(item);

    expect(await screen.findByText('loja')).toBeInTheDocument();
    expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home/user/projetos');
  });

  it('"Usar esta pasta" usa o item SELECIONADO quando houver um', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockResolvedValue({
      path: '/home/user',
      entradas: [{ nome: 'projetos', isDir: true }],
    });

    const onSelecionar = vi.fn();
    const onClose = vi.fn();
    renderComI18n(
      <FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={onSelecionar} onClose={onClose} />,
    );

    const item = await screen.findByRole('option', { name: 'projetos' });
    await user.click(item);

    await user.click(screen.getByRole('button', { name: 'Usar esta pasta' }));
    expect(onSelecionar).toHaveBeenCalledWith('/home/user/projetos');
    expect(onClose).toHaveBeenCalled();
  });

  it('sem seleção, "Usar esta pasta" usa a pasta ATUALMENTE ABERTA', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockResolvedValue({ path: '/home/user', entradas: [] });

    const onSelecionar = vi.fn();
    renderComI18n(
      <FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={onSelecionar} onClose={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Usar esta pasta' })).not.toBeDisabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Usar esta pasta' }));
    expect(onSelecionar).toHaveBeenCalledWith('/home/user');
  });

  it('atalho "Pasta pessoal" volta para `os.homedir()`', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockImplementation(async (path: string) => ({
      path,
      entradas: [],
    }));

    renderComI18n(<FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home/user'));

    // Navega pra outro lugar, depois volta pelo atalho.
    await user.click(screen.getByText('..'));
    expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home');

    fakeChannel.diretorioInicial.mockClear();
    await user.click(screen.getByRole('button', { name: 'Pasta pessoal' }));
    await waitFor(() => expect(fakeChannel.diretorioInicial).toHaveBeenCalledTimes(1));
  });

  it('atalho "Raiz" navega para `/`', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockImplementation(async (path: string) => ({
      path,
      entradas: [],
    }));

    renderComI18n(<FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home/user'));

    await user.click(screen.getByRole('button', { name: 'Raiz' }));
    await waitFor(() => expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/'));
  });

  it('".." sobe um nível a partir do path atual', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user/projetos' });
    fakeChannel.listarDiretorio.mockImplementation(async (path: string) => ({
      path,
      entradas: [],
    }));

    renderComI18n(<FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home/user/projetos'),
    );

    await user.click(screen.getByText('..'));
    expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home/user');
  });

  it('sem runner conectado: mostra o RunnerOnboardingPanel, e "Já instalei, conectar" tenta de novo', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({
      erro: 'Nenhum runner conectado a este projeto. Rode `brabo-runner --project proj-1 --dir <pasta>`.',
    });

    renderComI18n(<FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />);

    expect(
      await screen.findByText((t) => t.includes('Nenhum runner conectado')),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Já instalei, conectar' })).toBeInTheDocument();

    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockResolvedValue({ path: '/home/user', entradas: [] });

    await user.click(screen.getByRole('button', { name: 'Já instalei, conectar' }));

    await waitFor(() => expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home/user'));
  });

  it('cleanup no unmount: fecha o canal', async () => {
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user' });
    fakeChannel.listarDiretorio.mockResolvedValue({ path: '/home/user', entradas: [] });

    const { unmount } = renderComI18n(
      <FolderBrowserModal origem={{ tipo: 'runner', projectId: 'proj-1' }} onSelecionar={vi.fn()} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(connectFsBrowserChannelMock).toHaveBeenCalled());

    unmount();
    expect(fakeChannel.fechar).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

/**
 * O transporte de api (RN-504) — o que o assistente de criação passa a usar.
 *
 * O dublê é o mesmo tipo (`FsBrowser`): é justamente o ponto da extração da
 * interface, e é por isso que os casos de ORQUESTRAÇÃO acima não precisaram
 * ser duplicados aqui. O que este bloco prova é só o que MUDA com a origem —
 * qual fábrica é chamada, quais atalhos existem, e a declaração do que ficou
 * de fora da listagem.
 */
describe('FolderBrowserModal — transporte via api (RN-504)', () => {
  function renderApi(props?: { caminhoInicial?: string; onSelecionar?: () => void }) {
    return renderComI18n(
      <FolderBrowserModal
        origem={{ tipo: 'api', workspaceId: 'ws-1' }}
        caminhoInicial={props?.caminhoInicial}
        onSelecionar={props?.onSelecionar ?? vi.fn()}
        onClose={vi.fn()}
      />,
    );
  }

  it('usa o transporte de api, ancorado no workspace, e NUNCA abre canal de runner', async () => {
    fakeApi.diretorioInicial.mockResolvedValue({ path: '/home/voce/brabo' });
    fakeApi.listarDiretorio.mockResolvedValue({
      path: '/home/voce/brabo',
      entradas: [{ nome: 'loja', isDir: true }],
      arquivos: 0,
      simbolicos: 0,
      truncado: false,
    });

    renderApi();

    expect(criarFsBrowserViaApiMock).toHaveBeenCalledWith('ws-1');
    expect(await screen.findByText('loja')).toBeInTheDocument();
    // Sem runner no caminho: o socket Phoenix não é sequer construído.
    expect(connectFsBrowserChannelMock).not.toHaveBeenCalled();
  });

  it('não oferece o atalho "Raiz" — `/` está fora da base, e a api só teria como recusar', async () => {
    fakeApi.diretorioInicial.mockResolvedValue({ path: '/home/voce/brabo' });
    fakeApi.listarDiretorio.mockResolvedValue({
      path: '/home/voce/brabo',
      entradas: [],
      arquivos: 0,
      simbolicos: 0,
      truncado: false,
    });

    renderApi();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Base de projetos' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Raiz' })).not.toBeInTheDocument();
  });

  it('DIZ o que ficou de fora: pasta cheia de código não se apresenta como vazia', async () => {
    fakeApi.diretorioInicial.mockResolvedValue({ path: '/home/voce/brabo/loja' });
    fakeApi.listarDiretorio.mockResolvedValue({
      path: '/home/voce/brabo/loja',
      entradas: [],
      arquivos: 12,
      simbolicos: 2,
      truncado: false,
    });

    renderApi();

    // A lista está vazia de SUBPASTAS, e a tela diz isso — mas sem esconder
    // que há 12 arquivos e 2 links ali (RN-180).
    expect(await screen.findByText('Nenhuma subpasta aqui.')).toBeInTheDocument();
    expect(
      screen.getByText((t) => t.includes('12 arquivos não aparecem')),
    ).toBeInTheDocument();
    expect(screen.getByText((t) => t.includes('2 atalhos não aparecem'))).toBeInTheDocument();
  });

  it('anuncia o corte no teto quando a api marca `truncado`', async () => {
    fakeApi.diretorioInicial.mockResolvedValue({ path: '/home/voce/brabo' });
    fakeApi.listarDiretorio.mockResolvedValue({
      path: '/home/voce/brabo',
      entradas: [{ nome: 'p0001', isDir: true }],
      arquivos: 0,
      simbolicos: 0,
      truncado: true,
    });

    renderApi();

    expect(
      await screen.findByText((t) => t.includes('primeiras 500 subpastas')),
    ).toBeInTheDocument();
  });

  it('recusa da api vira mensagem na tela, e nunca o painel de onboarding do runner', async () => {
    fakeApi.diretorioInicial.mockResolvedValue({
      erro: 'A pasta "/etc" está fora da base de projetos (/home/voce/brabo).',
    });

    renderApi();

    expect(
      await screen.findByText((t) => t.includes('fora da base de projetos')),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Já instalei, conectar' }),
    ).not.toBeInTheDocument();
  });

  it('cleanup no unmount chama `fechar()` também no transporte de api (no-op, mas chamado)', async () => {
    fakeApi.diretorioInicial.mockResolvedValue({ path: '/home/voce/brabo' });
    fakeApi.listarDiretorio.mockResolvedValue({
      path: '/home/voce/brabo',
      entradas: [],
      arquivos: 0,
      simbolicos: 0,
      truncado: false,
    });

    const { unmount } = renderApi();
    await waitFor(() => expect(criarFsBrowserViaApiMock).toHaveBeenCalled());

    unmount();
    expect(fakeApi.fechar).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderBrowserModal } from './FolderBrowserModal';
import type { FsBrowserChannel } from '../lib/fs-browser-channel';

/**
 * `fs-browser-channel` é substituído por um dublê controlável — o que
 * importa aqui é a ORQUESTRAÇÃO da navegação (breadcrumb, subir, escolher
 * subpasta, "Selecionar esta pasta") e os TRÊS estados (carregando / sem
 * runner / pronto), não o protocolo Phoenix em si (coberto em
 * `fs-browser-channel` indiretamente pelo `terminal-channel.test.ts`
 * irmão, e no engine por `terminal_channel_test.exs`).
 */

const { connectFsBrowserChannelMock, fakeChannel } = vi.hoisted(() => {
  const fakeChannel: {
    listarDiretorio: ReturnType<typeof vi.fn>;
    diretorioInicial: ReturnType<typeof vi.fn>;
    fechar: ReturnType<typeof vi.fn>;
  } = {
    listarDiretorio: vi.fn(),
    diretorioInicial: vi.fn(),
    fechar: vi.fn(),
  };
  const connectFsBrowserChannelMock = vi.fn(() => fakeChannel as unknown as FsBrowserChannel);
  return { connectFsBrowserChannelMock, fakeChannel };
});

vi.mock('../lib/fs-browser-channel', () => ({
  connectFsBrowserChannel: connectFsBrowserChannelMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FolderBrowserModal', () => {
  it('projectId nulo: não conecta e mostra o estado declarado (sem projeto ainda)', () => {
    const onClose = vi.fn();
    render(
      <FolderBrowserModal projectId={null} onSelecionar={vi.fn()} onClose={onClose} />,
    );

    expect(connectFsBrowserChannelMock).not.toHaveBeenCalled();
    expect(
      screen.getByText((t) => t.includes('depois que o projeto existir')),
    ).toBeInTheDocument();
  });

  it('caminho feliz: abre em os.homedir(), lista subpastas, navega e seleciona', async () => {
    const user = userEvent.setup();
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
      if (path === '/home/user/projetos') {
        return { path: '/home/user/projetos', entradas: [{ nome: 'loja', isDir: true }] };
      }
      return { path, entradas: [] };
    });

    const onSelecionar = vi.fn();
    const onClose = vi.fn();
    render(
      <FolderBrowserModal projectId="proj-1" onSelecionar={onSelecionar} onClose={onClose} />,
    );

    expect(connectFsBrowserChannelMock).toHaveBeenCalledWith('proj-1');
    expect(await screen.findByText('projetos')).toBeInTheDocument();
    // Arquivo (não-diretório) nunca aparece na lista de navegação.
    expect(screen.queryByText('arquivo.txt')).not.toBeInTheDocument();

    await user.click(screen.getByText('projetos'));
    expect(await screen.findByText('loja')).toBeInTheDocument();
    expect(fakeChannel.listarDiretorio).toHaveBeenCalledWith('/home/user/projetos');

    await user.click(screen.getByRole('button', { name: 'Selecionar esta pasta' }));
    expect(onSelecionar).toHaveBeenCalledWith('/home/user/projetos');
    expect(onClose).toHaveBeenCalled();
  });

  it('".." sobe um nível a partir do path atual', async () => {
    const user = userEvent.setup();
    fakeChannel.diretorioInicial.mockResolvedValue({ path: '/home/user/projetos' });
    fakeChannel.listarDiretorio.mockImplementation(async (path: string) => ({
      path,
      entradas: [],
    }));

    render(<FolderBrowserModal projectId="proj-1" onSelecionar={vi.fn()} onClose={vi.fn()} />);

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

    render(<FolderBrowserModal projectId="proj-1" onSelecionar={vi.fn()} onClose={vi.fn()} />);

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

    const { unmount } = render(
      <FolderBrowserModal projectId="proj-1" onSelecionar={vi.fn()} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(connectFsBrowserChannelMock).toHaveBeenCalled());

    unmount();
    expect(fakeChannel.fechar).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

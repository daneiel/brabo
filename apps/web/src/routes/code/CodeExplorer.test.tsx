import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeExplorer } from './CodeExplorer';
import type { CodeTree } from '../../lib/api-types';

const getCodeTree = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getCodeTree: (...args: unknown[]) => getCodeTree(...args),
  };
});

function montar(activePath: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenFile = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <CodeExplorer projectId="p-1" gitRef="dev" activePath={activePath} onOpenFile={onOpenFile} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenFile };
}

const RAIZ: CodeTree = {
  ref: 'dev',
  path: '',
  entries: [
    { path: 'apps', name: 'apps', type: 'dir', size: null },
    { path: 'README.md', name: 'README.md', type: 'file', size: 120 },
  ],
  truncated: false,
};

const FILHOS_APPS: CodeTree = {
  ref: 'dev',
  path: 'apps',
  entries: [{ path: 'apps/web', name: 'web', type: 'dir', size: null }],
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CodeExplorer — caminho feliz', () => {
  it('carrega a raiz sozinha e mostra pastas e arquivos', async () => {
    getCodeTree.mockResolvedValue(RAIZ);

    montar();

    expect(await screen.findByText('apps')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    expect(getCodeTree).toHaveBeenCalledWith('p-1', { ref: 'dev', path: '' });
  });

  it('clicar num arquivo abre — clicar numa pasta CARREGA por diretório (lazy)', async () => {
    getCodeTree.mockImplementation((_projectId: string, opts: { path?: string }) =>
      Promise.resolve(opts.path === 'apps' ? FILHOS_APPS : RAIZ),
    );
    const user = userEvent.setup();
    const { onOpenFile } = montar();

    await screen.findByText('apps');
    await user.click(screen.getByText('README.md'));
    expect(onOpenFile).toHaveBeenCalledWith('README.md');

    // A pasta só é pedida quando EXPANDIDA — não na montagem da raiz.
    expect(getCodeTree).not.toHaveBeenCalledWith('p-1', { ref: 'dev', path: 'apps' });
    await user.click(screen.getByText('apps'));
    expect(await screen.findByText('web')).toBeInTheDocument();
    expect(getCodeTree).toHaveBeenCalledWith('p-1', { ref: 'dev', path: 'apps' });
  });
});

describe('CodeExplorer — os três estados (RN-088)', () => {
  it('carregando', () => {
    getCodeTree.mockReturnValue(new Promise(() => {}));
    montar();
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('erro — nunca vira raiz vazia em silêncio', async () => {
    getCodeTree.mockRejectedValue(new Error('boom'));
    montar();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
  });

  it('vazio — repositório sem entradas na raiz', async () => {
    getCodeTree.mockResolvedValue({ ref: 'dev', path: '', entries: [], truncated: false });
    montar();
    expect(await screen.findByText('Repositório vazio nesta ref.')).toBeInTheDocument();
  });
});

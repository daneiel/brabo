import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeSearchPanel } from './CodeSearchPanel';
import type { CodeSearchResult } from '../../lib/api-types';

const searchCode = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    searchCode: (...args: unknown[]) => searchCode(...args),
  };
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenFile = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <CodeSearchPanel projectId="p-1" gitRef="dev" onOpenFile={onOpenFile} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenFile };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CodeSearchPanel', () => {
  it('não busca antes de o usuário submeter — é o orçamento da rota, não do teclado', () => {
    montar();
    expect(screen.getByText(/Digite um termo/i)).toBeInTheDocument();
    expect(searchCode).not.toHaveBeenCalled();
  });

  it('termo curto demais não dispara a busca', async () => {
    const user = userEvent.setup();
    montar();
    await user.type(screen.getByLabelText('Termo de busca'), 'x');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(searchCode).not.toHaveBeenCalled();
  });

  it('caminho feliz: mostra resultados, filesScanned e abre arquivo ao clicar', async () => {
    const resultado: CodeSearchResult = {
      ref: 'dev',
      path: '',
      query: 'fetchUser',
      matches: [{ path: 'apps/api/src/user.ts', line: 12, text: '  fetchUser(id)' }],
      filesScanned: 40,
      truncated: false,
    };
    searchCode.mockResolvedValue(resultado);
    const user = userEvent.setup();
    const { onOpenFile } = montar();

    await user.type(screen.getByLabelText('Termo de busca'), 'fetchUser');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('apps/api/src/user.ts')).toBeInTheDocument();
    expect(screen.getByText('40 arquivo(s) verificado(s)')).toBeInTheDocument();
    expect(searchCode).toHaveBeenCalledWith('p-1', { q: 'fetchUser', ref: 'dev' });

    await user.click(screen.getByText('apps/api/src/user.ts'));
    expect(onOpenFile).toHaveBeenCalledWith('apps/api/src/user.ts');
  });

  it('vazio: sem casamento é diferente de erro (RN-088 / achado Y)', async () => {
    searchCode.mockResolvedValue({
      ref: 'dev', path: '', query: 'xyz', matches: [], filesScanned: 5, truncated: false,
    });
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText('Termo de busca'), 'xyz');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText(/Nenhum resultado para/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('erro: mensagem da api e botão de tentar de novo', async () => {
    searchCode.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText('Termo de busca'), 'algo');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
  });
});

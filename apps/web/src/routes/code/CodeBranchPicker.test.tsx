import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeBranchPicker } from './CodeBranchPicker';
import type { CodeBranchDetailList } from '../../lib/api-types';

const getCodeBranches = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getCodeBranches: (...args: unknown[]) => getCodeBranches(...args),
  };
});

function montar(currentRef = 'dev') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelect = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <CodeBranchPicker projectId="p-1" currentRef={currentRef} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { ...utils, onSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CodeBranchPicker', () => {
  it('caminho feliz: abre a lista com ahead/behind e badge de PR, e escolher chama onSelect', async () => {
    const lista: CodeBranchDetailList = {
      items: [
        {
          name: 'dev',
          commitSha: 'a1',
          protected: true,
          ahead: 0,
          behind: 0,
          pullRequest: null,
          producedBy: null,
        },
        {
          name: 'feature/refresh-grace',
          commitSha: 'b2',
          protected: false,
          ahead: 4,
          behind: 2,
          pullRequest: { number: 218, state: 'open' },
          producedBy: null,
        },
        {
          name: 'hotfix/token-leak',
          commitSha: 'c3',
          protected: false,
          ahead: 1,
          behind: 0,
          pullRequest: { number: 99, state: 'merged' },
          producedBy: null,
        },
      ],
      truncated: false,
    };
    getCodeBranches.mockResolvedValue(lista);
    const user = userEvent.setup();
    const { onSelect } = montar('dev');

    await user.click(screen.getByRole('button', { name: /dev/ }));

    expect(await screen.findByText('feature/refresh-grace')).toBeInTheDocument();
    expect(screen.getByText(/↑4 ↓2/)).toBeInTheDocument();
    expect(screen.getByText(/PR #218/)).toBeInTheDocument();
    expect(screen.getByText(/PR #99 \(mesclada\)/)).toBeInTheDocument();
    expect(getCodeBranches).toHaveBeenCalledWith('p-1');

    await user.click(screen.getByText('feature/refresh-grace'));
    expect(onSelect).toHaveBeenCalledWith('feature/refresh-grace');
  });

  it('branch de task mostra o dev agent dono; branch sem padrão não ganha selo (RN-152)', async () => {
    const lista: CodeBranchDetailList = {
      items: [
        { name: 'dev', commitSha: 'a1', protected: true, ahead: 0, behind: 0, pullRequest: null, producedBy: null },
        {
          name: 'feature/task-3f2b1c8e',
          commitSha: 'b2',
          protected: false,
          ahead: 3,
          behind: 0,
          pullRequest: null,
          producedBy: { agentId: 'dev-pieces', moduleId: 'pieces' },
        },
        {
          name: 'feature/refatoracao-manual',
          commitSha: 'c3',
          protected: false,
          ahead: 1,
          behind: 0,
          pullRequest: null,
          producedBy: null,
        },
      ],
      truncated: false,
    };
    getCodeBranches.mockResolvedValue(lista);
    const user = userEvent.setup();
    montar('dev');

    await user.click(screen.getByRole('button', { name: /dev/ }));

    expect(await screen.findByText('feature/task-3f2b1c8e')).toBeInTheDocument();
    // Selo do dev agent: título com agentId + módulo, e o agentId também no
    // texto de meta da linha — nenhum dos dois aparece pra branch manual.
    expect(screen.getByTitle(/dev-pieces/)).toBeInTheDocument();
    expect(screen.getByText(/dev-pieces/)).toBeInTheDocument();

    const manual = screen.getByText('feature/refatoracao-manual').closest('button');
    expect(manual).not.toBeNull();
    expect(manual?.querySelector('[title*="dev-"]')).toBeNull();
  });

  it('erro: mensagem da api e botão de tentar de novo, sem colapsar num estado só', async () => {
    getCodeBranches.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    montar('dev');

    await user.click(screen.getByRole('button', { name: /dev/ }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
  });
});

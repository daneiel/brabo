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
        { name: 'dev', commitSha: 'a1', protected: true, ahead: 0, behind: 0, pullRequest: null },
        {
          name: 'feature/refresh-grace',
          commitSha: 'b2',
          protected: false,
          ahead: 4,
          behind: 2,
          pullRequest: { number: 218, state: 'open' },
        },
        {
          name: 'hotfix/token-leak',
          commitSha: 'c3',
          protected: false,
          ahead: 1,
          behind: 0,
          pullRequest: { number: 99, state: 'merged' },
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

  it('erro: mensagem da api e botão de tentar de novo, sem colapsar num estado só', async () => {
    getCodeBranches.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    montar('dev');

    await user.click(screen.getByRole('button', { name: /dev/ }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
  });
});

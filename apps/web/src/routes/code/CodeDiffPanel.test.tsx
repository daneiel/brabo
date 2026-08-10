import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeDiffPanel } from './CodeDiffPanel';
import type { CodeDiff, CodePullRequestList } from '../../lib/api-types';

const getCodeDiff = vi.fn();
const getCodePullRequests = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getCodeDiff: (...args: unknown[]) => getCodeDiff(...args),
    getCodePullRequests: (...args: unknown[]) => getCodePullRequests(...args),
  };
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeDiffPanel projectId="p-1" />
    </QueryClientProvider>,
  );
}

async function pedirDiffPeloId(id: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Já sabe o id?'), id);
  await user.click(screen.getByRole('button', { name: 'Ver diff' }));
}

const listaVazia: CodePullRequestList = { items: [], truncated: false };

beforeEach(() => {
  vi.clearAllMocks();
  getCodePullRequests.mockResolvedValue(listaVazia);
});

describe('CodeDiffPanel — lista de PRs', () => {
  it('carrega a lista de PRs abertas por padrão', async () => {
    montar();
    expect(await screen.findByText('Nenhuma PR aberta neste repositório.')).toBeInTheDocument();
    expect(getCodePullRequests).toHaveBeenCalledWith('p-1', { state: 'open' });
  });

  it('lista PRs reais e clicar numa delas abre o diff certo', async () => {
    const lista: CodePullRequestList = {
      items: [
        {
          id: 'pr-218',
          number: 218,
          title: 'feat: aba code',
          url: 'https://example.com/pr/218',
          author: 'daneiel',
          state: 'open',
          sourceBranch: 'feature/aba-code',
          targetBranch: 'dev',
          updatedAt: null,
        },
      ],
      truncated: false,
    };
    getCodePullRequests.mockResolvedValue(lista);

    const diff: CodeDiff = { pullRequestId: 'pr-218', files: [], truncated: false };
    getCodeDiff.mockResolvedValue(diff);

    montar();
    expect(await screen.findByText('#218 feat: aba code')).toBeInTheDocument();
    expect(screen.getByText('daneiel · feature/aba-code → dev')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir PR #218: feat: aba code' }));

    expect(getCodeDiff).toHaveBeenCalledWith('p-1', 'pr-218');
    expect(await screen.findByText('Esta PR não mudou nenhum arquivo.')).toBeInTheDocument();
    expect(screen.getByText('#218 feat: aba code')).toBeInTheDocument();
    expect(screen.getByText('feature/aba-code → dev')).toBeInTheDocument();

    // Voltar à lista limpa a PR selecionada e mostra a lista de novo.
    await user.click(screen.getByRole('button', { name: 'Voltar à lista' }));
    expect(await screen.findByText('#218 feat: aba code')).toBeInTheDocument();
  });

  it('filtro de estado troca a chamada à api', async () => {
    montar();
    await screen.findByText('Nenhuma PR aberta neste repositório.');
    getCodePullRequests.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Mescladas' }));

    expect(getCodePullRequests).toHaveBeenCalledWith('p-1', { state: 'merged' });
    expect(await screen.findByText('Nenhuma PR mesclada neste repositório.')).toBeInTheDocument();
  });

  it('erro ao listar tem mensagem e botão de tentar de novo', async () => {
    getCodePullRequests.mockRejectedValue(new Error('boom'));
    montar();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
  });
});

describe('CodeDiffPanel — diff por id conhecido', () => {
  it('patch nulo é "sem texto disponível" — nunca "sem mudança"', async () => {
    const diff: CodeDiff = {
      pullRequestId: '218',
      files: [
        {
          path: 'apps/api/assets/logo.png',
          previousPath: null,
          status: 'modified',
          additions: 0,
          deletions: 0,
          patch: null,
        },
      ],
      truncated: false,
    };
    getCodeDiff.mockResolvedValue(diff);
    montar();
    await screen.findByText('Nenhuma PR aberta neste repositório.');
    await pedirDiffPeloId('218');

    expect(await screen.findByText('apps/api/assets/logo.png')).toBeInTheDocument();
    // O corpo do disclosure só monta quando aberto — abrir para conferir a frase.
    const user = userEvent.setup();
    await user.click(screen.getByText('apps/api/assets/logo.png'));
    expect(
      await screen.findByText('Sem texto de diff disponível para este arquivo.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sem mudança/i)).not.toBeInTheDocument();
  });

  it('patch vazio ("") é distinto de patch nulo', async () => {
    const diff: CodeDiff = {
      pullRequestId: '219',
      files: [
        {
          path: 'apps/api/mode.sh',
          previousPath: null,
          status: 'modified',
          additions: 0,
          deletions: 0,
          patch: '',
        },
      ],
      truncated: false,
    };
    getCodeDiff.mockResolvedValue(diff);
    montar();
    await screen.findByText('Nenhuma PR aberta neste repositório.');
    await pedirDiffPeloId('219');

    const user = userEvent.setup();
    await screen.findByText('apps/api/mode.sh');
    await user.click(screen.getByText('apps/api/mode.sh'));
    expect(
      await screen.findByText('Diff sem conteúdo de texto (ex.: só mudança de modo).'),
    ).toBeInTheDocument();
  });

  it('PR sem arquivos mudados é "vazio", não erro', async () => {
    getCodeDiff.mockResolvedValue({ pullRequestId: '1', files: [], truncated: false });
    montar();
    await screen.findByText('Nenhuma PR aberta neste repositório.');
    await pedirDiffPeloId('1');
    expect(await screen.findByText('Esta PR não mudou nenhum arquivo.')).toBeInTheDocument();
  });

  it('erro tem mensagem e botão de tentar de novo', async () => {
    getCodeDiff.mockRejectedValue(new Error('boom'));
    montar();
    await screen.findByText('Nenhuma PR aberta neste repositório.');
    await pedirDiffPeloId('1');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeDiffPanel } from './CodeDiffPanel';
import type { CodeDiff } from '../../lib/api-types';

const getCodeDiff = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getCodeDiff: (...args: unknown[]) => getCodeDiff(...args),
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

async function pedirDiff(id: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Id da PR'), id);
  await user.click(screen.getByRole('button', { name: 'Ver diff' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CodeDiffPanel', () => {
  it('sem id digitado, não pede nada — não há lista de PRs para escolher', () => {
    montar();
    expect(screen.getByText(/Sem lista de PRs aqui/)).toBeInTheDocument();
    expect(getCodeDiff).not.toHaveBeenCalled();
  });

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
    await pedirDiff('218');

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
    await pedirDiff('219');

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
    await pedirDiff('1');
    expect(await screen.findByText('Esta PR não mudou nenhum arquivo.')).toBeInTheDocument();
  });

  it('erro tem mensagem e botão de tentar de novo', async () => {
    getCodeDiff.mockRejectedValue(new Error('boom'));
    montar();
    await pedirDiff('1');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
  });
});

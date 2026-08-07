import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewProjectWizard } from './NewProjectWizard';
import { ToastProvider } from '../components/ui/ToastProvider';

const createProject = vi.fn();
const listCredentials = vi.fn();
const registerGitCredential = vi.fn();

vi.mock('../lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  createProject: (...a: unknown[]) => createProject(...a),
  listCredentials: (...a: unknown[]) => listCredentials(...a),
  registerGitCredential: (...a: unknown[]) => registerGitCredential(...a),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NewProjectWizard workspaceId="ws-1" onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Avança do passo 1 (modo) e 2 (provider) até o de nome e visibilidade. */
async function ateVisibilidade(provider: 'GitHub' | 'Local') {
  montar();
  fireEvent.click(screen.getByText('Criar novo'));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  fireEvent.click(screen.getByText(provider));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  // O GitHub tem um passo de credencial no meio; com uma já cadastrada ele
  // auto-seleciona num efeito, e só ENTÃO o Continuar libera. Clicar antes
  // disso não avança — foi o que fez este helper parar no passo 3.
  if (provider === 'GitHub') {
    const continuar = await screen.findByRole('button', { name: 'Continuar' });
    await waitFor(() => expect(continuar).not.toBeDisabled());
    fireEvent.click(continuar);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  listCredentials.mockResolvedValue([
    {
      id: 'cred-1',
      provider: 'github',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ]);
});

/**
 * O aviso do repositório privado no GitHub.
 *
 * No plano gratuito, repositório privado NÃO aceita proteção de branch — e o
 * bootstrap descobre isso no último passo, com o repositório já criado e a
 * mensagem crua da API na tela. Era tarde demais para uma decisão que se toma
 * dois passos antes.
 */
describe('NewProjectWizard — aviso de repositório privado', () => {
  it('avisa quando o provider é GitHub e a visibilidade é privada', async () => {
    await ateVisibilidade('GitHub');

    expect(
      await screen.findByText(/não aceita proteção de branch/i),
    ).toBeTruthy();
  });

  it('some ao escolher Público — lá a proteção funciona', async () => {
    await ateVisibilidade('GitHub');
    await screen.findByText(/não aceita proteção de branch/i);

    fireEvent.click(screen.getByRole('button', { name: 'Público' }));

    expect(screen.queryByText(/não aceita proteção de branch/i)).toBeNull();
  });

  /** O limite é do GitHub. Repetir o aviso no Local seria mentira. */
  it('não aparece no provider Local, que não tem plano nenhum', async () => {
    await ateVisibilidade('Local');

    expect(screen.queryByText(/não aceita proteção de branch/i)).toBeNull();
  });
});

import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewProjectWizard } from './NewProjectWizard';
import { ToastProvider } from '../components/ui/ToastProvider';
// A instância REAL do app: `FolderBrowserModal`/`Modal` usam
// `useTranslation('terminal'|'ui')` sem `I18nextProvider` próprio (mesmo
// padrão de `Dashboard.test.tsx`) — `NewProjectWizard.tsx` em si ainda não
// foi migrado, então só o modal de pasta depende disto.
import i18n from '../lib/i18n';

const createProject = vi.fn();
const listCredentials = vi.fn();
const registerGitCredential = vi.fn();

vi.mock('../lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    // `body` entrou porque a recusa do caminho Local (RN-170) é lida DALI: a
    // mensagem que ensina como montar a pasta vem no corpo da resposta, não
    // no `message` do erro de transporte.
    constructor(status: number, body?: unknown) {
      super(`api error ${status}`);
      this.status = status;
      this.body = body;
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

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
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
afterAll(() => {
  void i18n.changeLanguage('en');
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

/**
 * O passo "Onde o código vai morar" (RN-169/RN-170, ADR 0072).
 *
 * Duas coisas são provadas aqui, e a segunda é o ponto da entrega: que o modo
 * escolhido CHEGA à api, e que a recusa dela — a mensagem que ensina a montar
 * a pasta — aparece NA TELA em vez de virar um toast genérico.
 */
describe('NewProjectWizard — onde o código vai morar', () => {
  /** Do passo 1 até o de workspace, no provider Local (sem credencial). */
  async function ateWorkspace() {
    await ateVisibilidade('Local');
    fireEvent.change(screen.getByLabelText('Nome do projeto'), {
      target: { value: 'Loja' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText('Onde o código vai morar');
  }

  it('Container é o pré-selecionado e vai para a api como tal — nada muda para quem não escolhe', async () => {
    createProject.mockResolvedValue({ id: 'proj-1' });
    await ateWorkspace();

    // Avança sem digitar nada: é o comportamento de sempre.
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    expect(createProject.mock.calls[0][1]).toEqual({
      name: 'Loja',
      slug: 'loja',
      executionMode: 'container',
    });
  });

  it('Pasta montada manda o caminho digitado, e só ele', async () => {
    createProject.mockResolvedValue({ id: 'proj-1' });
    await ateWorkspace();

    fireEvent.click(screen.getByText('Pasta montada'));
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    expect(createProject.mock.calls[0][1]).toEqual({
      name: 'Loja',
      slug: 'loja',
      executionMode: 'mounted',
      workspacePath: '/home/voce/projetos/loja',
    });
  });

  it('Pasta montada sem caminho não avança — a tela não deixa mandar o que a api recusaria', async () => {
    await ateWorkspace();

    fireEvent.click(screen.getByText('Pasta montada'));

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('a RECUSA da api aparece na tela com a instrução de montagem, não como toast genérico', async () => {
    const { ApiError } = await import('../lib/api-client');
    createProject.mockRejectedValue(
      new (ApiError as new (s: number, b: unknown) => Error)(400, {
        message:
          'A pasta /home/voce/projetos/loja não existe do lado de dentro da api. ' +
          'No docker/docker-compose.yml, acrescente a mesma linha aos serviços "api" e "engine".',
      }),
    );
    await ateWorkspace();

    fireEvent.click(screen.getByText('Pasta montada'));
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    expect(
      await screen.findByText(/não existe do lado de dentro da api/i),
    ).toBeTruthy();
    expect(screen.getByText(/docker-compose\.yml/)).toBeTruthy();
  });

  /**
   * "Procurar pasta..." (ADR 0107, navegação de pasta via o Runner). Nesta
   * tela o projeto AINDA não existe (só nasce na confirmação) — o modal
   * mostra o estado declarado em vez de tentar conectar a um runner sem
   * projeto para ancorar. O campo de texto livre continua sendo o caminho
   * de verdade aqui, exatamente como antes desta entrega.
   */
  it('"Procurar pasta..." mostra o estado declarado (sem projeto ainda), e digitar continua funcionando', async () => {
    await ateWorkspace();
    fireEvent.click(screen.getByText('Pasta montada'));

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));

    expect(
      await screen.findByText((t) => t.includes('depois que o projeto existir')),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(
      screen.queryByText((t) => t.includes('depois que o projeto existir')),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });
    expect(screen.getByLabelText('Caminho da pasta')).toHaveValue(
      '/home/voce/projetos/loja',
    );
  });

  /** RN-423 (ADR 0104): sem bind-mount, o caminho só é confirmado quando o
   * runner conectar — nada aqui trava a criação nem promete recusa na hora. */
  it('Runner local manda o caminho digitado e mostra o comando pra confirmar depois', async () => {
    createProject.mockResolvedValue({ id: 'proj-1' });
    await ateWorkspace();

    fireEvent.click(screen.getByText('Runner local'));
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });

    expect(screen.getByText(/brabo-runner --project/)).toBeTruthy();
    expect(
      screen.getByText(/runner confirma o caminho ao conectar/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    expect(createProject.mock.calls[0][1]).toEqual({
      name: 'Loja',
      slug: 'loja',
      executionMode: 'runner',
      workspacePath: '/home/voce/projetos/loja',
    });
  });

  it('Runner local sem caminho não avança — mesma régua léxica de Pasta montada', async () => {
    await ateWorkspace();

    fireEvent.click(screen.getByText('Runner local'));

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });
});

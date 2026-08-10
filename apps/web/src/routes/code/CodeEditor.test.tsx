import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeEditor } from './CodeEditor';
import type { CodeBlame, CodeFile } from '../../lib/api-types';

const getCodeFile = vi.fn();
const getCodeBlame = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getCodeFile: (...args: unknown[]) => getCodeFile(...args),
    getCodeBlame: (...args: unknown[]) => getCodeBlame(...args),
  };
});

const arquivo: CodeFile = {
  ref: 'dev',
  path: 'apps/api/src/user.ts',
  content: 'const a = 1;\nconst b = 2;\n',
  truncated: false,
  bytes: 26,
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeEditor
        projectId="p-1"
        gitRef="dev"
        openTabs={['apps/api/src/user.ts']}
        activePath="apps/api/src/user.ts"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

async function ligarBlame() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Blame/i }));
  return user;
}

/**
 * O realce de sintaxe quebra cada linha em vários `<span>` (um por token), então
 * o texto da linha não é o texto DIRETO de nenhum nó — é a soma dos filhos. O
 * `getByText` padrão só olha nós de texto diretos (ver `getNodeText` da
 * testing-library), por isso o matcher customizado que a própria doc recomenda
 * para texto partido entre elementos.
 */
function porTextoDaLinha(texto: string) {
  return (_content: string, element: Element | null) => {
    if (!element) return false;
    const igual = (el: Element) => el.textContent === texto;
    return igual(element) && Array.from(element.children).every((filho) => !igual(filho));
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCodeFile.mockResolvedValue(arquivo);
});

describe('CodeEditor — blame', () => {
  it('não pede blame ao abrir o arquivo — só quando o toggle é ligado (RN-113)', async () => {
    montar();
    await screen.findByText(porTextoDaLinha('const a = 1;'));
    expect(getCodeBlame).not.toHaveBeenCalled();
  });

  it('caminho feliz: liga o toggle, carrega e anota autor + sha por linha', async () => {
    const blame: CodeBlame = {
      ref: 'dev',
      path: 'apps/api/src/user.ts',
      lines: [
        {
          line: 1,
          commitSha: 'abc1234567',
          author: 'Daniel Souza',
          authorDate: '2026-08-01T10:00:00.000Z',
          summary: 'feat: adiciona a',
        },
        {
          line: 2,
          commitSha: 'def9876543',
          author: 'Outra Pessoa',
          authorDate: '2026-08-02T11:00:00.000Z',
          summary: 'feat: adiciona b',
        },
      ],
      truncated: false,
    };
    getCodeBlame.mockResolvedValue(blame);
    montar();
    await screen.findByText(porTextoDaLinha('const a = 1;'));

    await ligarBlame();

    expect(await screen.findByText('Daniel Souza · abc1234')).toBeInTheDocument();
    expect(screen.getByText('Outra Pessoa · def9876')).toBeInTheDocument();
    expect(getCodeBlame).toHaveBeenCalledWith('p-1', { ref: 'dev', path: 'apps/api/src/user.ts' });
  });

  it('linhas consecutivas do MESMO commit não repetem o texto', async () => {
    const blame: CodeBlame = {
      ref: 'dev',
      path: 'apps/api/src/user.ts',
      lines: [
        {
          line: 1,
          commitSha: 'abc1234567',
          author: 'Daniel Souza',
          authorDate: '2026-08-01T10:00:00.000Z',
          summary: 'feat: adiciona a e b',
        },
        {
          line: 2,
          commitSha: 'abc1234567',
          author: 'Daniel Souza',
          authorDate: '2026-08-01T10:00:00.000Z',
          summary: 'feat: adiciona a e b',
        },
      ],
      truncated: false,
    };
    getCodeBlame.mockResolvedValue(blame);
    montar();
    await screen.findByText(porTextoDaLinha('const a = 1;'));

    await ligarBlame();

    expect(await screen.findAllByText('Daniel Souza · abc1234')).toHaveLength(1);
  });

  it('erro: mensagem da api e botão de tentar de novo, sem esconder o arquivo', async () => {
    getCodeBlame.mockRejectedValue(new Error('boom'));
    montar();
    await screen.findByText(porTextoDaLinha('const a = 1;'));

    await ligarBlame();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
    // O conteúdo do arquivo continua visível — erro de blame não derruba o editor.
    expect(screen.getByText(porTextoDaLinha('const a = 1;'))).toBeInTheDocument();
  });

  it('arquivo sem histórico de blame é estado vazio, não erro', async () => {
    getCodeBlame.mockResolvedValue({ ref: 'dev', path: 'apps/api/src/user.ts', lines: [], truncated: false });
    montar();
    await screen.findByText(porTextoDaLinha('const a = 1;'));

    await ligarBlame();

    expect(await screen.findByText('Sem anotações de autoria para este arquivo.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

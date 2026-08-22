import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
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

function contarLinhasRenderizadas(): number[] {
  return Array.from(document.querySelectorAll('[data-line-row]')).map((el) =>
    Number(el.getAttribute('data-line-row')),
  );
}

const TOTAL_LINHAS_GRANDE = 5000;

function montarArquivoGrande() {
  const linhas = Array.from({ length: TOTAL_LINHAS_GRANDE }, (_, i) => `const linha${i} = ${i};`);
  const conteudo = linhas.join('\n');
  const arquivoGrande: CodeFile = {
    ref: 'dev',
    path: 'apps/web/src/grande.ts',
    content: conteudo,
    truncated: false,
    bytes: conteudo.length,
  };
  getCodeFile.mockResolvedValue(arquivoGrande);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeEditor
        projectId="p-1"
        gitRef="dev"
        openTabs={['apps/web/src/grande.ts']}
        activePath="apps/web/src/grande.ts"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/**
 * Prova de verdade da virtualização (RN-239/240): um arquivo de 5.000 linhas
 * NÃO pode gerar 5.000 nós `[data-line-row]` — contar os nós de fato
 * renderizados é o que distingue "a janela funciona" de "passa no teste
 * unitário porque o componente não quebrou".
 */
describe('CodeEditor — virtualização', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caminho feliz: arquivo de 5.000 linhas renderiza uma janela pequena de nós, não o arquivo inteiro', async () => {
    // Container medido como 600px de altura — sem isto, `clientHeight` no
    // jsdom é sempre 0 e a janela cai no fallback generoso de teste.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);

    montarArquivoGrande();
    await screen.findByTestId('editor-scroll');
    await screen.findByText((_, el) => el?.getAttribute('data-line-row') === '1');

    const numeros = contarLinhasRenderizadas();
    expect(numeros.length).toBeGreaterThan(0);
    // Janela = ceil(600/21) + 2*OVERSCAN(20) ≈ 69 linhas — bem longe de 5.000.
    expect(numeros.length).toBeLessThan(150);
    expect(Math.max(...numeros)).toBeLessThan(TOTAL_LINHAS_GRANDE);

    // O espaçador de baixo reserva a altura do resto do arquivo sem existir
    // como linha — é ELE que mantém a barra de rolagem do tamanho certo.
    const espacadorFundo = screen.getByTestId('espacador-fundo');
    expect(espacadorFundo).toBeInTheDocument();
    expect(espacadorFundo.style.height).not.toBe('0px');
  });

  it('rolar para o meio do arquivo troca a janela — linha 1 some, linhas do meio aparecem', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    montarArquivoGrande();
    await screen.findByText((_, el) => el?.getAttribute('data-line-row') === '1');

    const scroller = screen.getByTestId('editor-scroll');
    // 2.500 linhas * 21px — bem no meio do arquivo de 5.000 linhas.
    fireEvent.scroll(scroller, { target: { scrollTop: 2500 * 21 } });

    await screen.findByText((_, el) => el?.getAttribute('data-line-row') === '2481');
    expect(document.querySelector('[data-line-row="1"]')).not.toBeInTheDocument();
    const numeros = contarLinhasRenderizadas();
    expect(numeros.every((n) => n > 2400 && n < 2600)).toBe(true);
  });

  it('falha/borda: sem medição de altura (jsdom sem ResizeObserver, clientHeight 0), degrada para uma janela padrão em vez de não renderizar nada', async () => {
    // Nenhum mock de clientHeight aqui — é exatamente o caso "não consegui medir".
    const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i}`);
    const conteudo = linhas.join('\n');
    const arquivo30: CodeFile = {
      ref: 'dev',
      path: 'apps/web/src/pequeno.ts',
      content: conteudo,
      truncated: false,
      bytes: conteudo.length,
    };
    getCodeFile.mockResolvedValue(arquivo30);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CodeEditor
          projectId="p-1"
          gitRef="dev"
          openTabs={['apps/web/src/pequeno.ts']}
          activePath="apps/web/src/pequeno.ts"
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await screen.findByText((_, el) => el?.getAttribute('data-line-row') === '1');
    // As 30 linhas cabem no fallback (LINHAS_SEM_MEDICAO*1 + OVERSCAN*2) — nenhuma
    // fica escondida só porque a altura do painel não pôde ser medida.
    expect(contarLinhasRenderizadas()).toHaveLength(30);
  });
});

describe('CodeEditor — minimapa', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('caminho feliz: clicar no minimapa rola o editor e troca a janela renderizada', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 600,
      width: 64,
      top: 0,
      left: 0,
      bottom: 600,
      right: 64,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect);

    montarArquivoGrande();
    await screen.findByText((_, el) => el?.getAttribute('data-line-row') === '1');

    const minimapa = screen.getByRole('button', { name: /Minimapa/i });
    expect(minimapa).toBeInTheDocument();

    const scroller = screen.getByTestId('editor-scroll') as HTMLDivElement;
    const scrollAntes = scroller.scrollTop;

    // Clique no meio do overlay — deve pular para perto do meio do arquivo.
    // `fireEvent` (não `userEvent`) porque precisamos controlar `clientY`
    // diretamente — é ele que o handler de clique do minimapa lê.
    fireEvent.click(minimapa, { clientY: 300 });

    expect(scroller.scrollTop).toBeGreaterThan(scrollAntes);
    const numeros = contarLinhasRenderizadas();
    expect(Math.min(...numeros)).toBeGreaterThan(1000);
    expect(document.querySelector('[data-line-row="1"]')).not.toBeInTheDocument();
  });

  it('falha: sem contexto de canvas 2D (jsdom sem o pacote `canvas`), o overlay continua clicável e nada quebra', async () => {
    // Não mockeamos getContext — jsdom já devolve null por padrão aqui, que é
    // exatamente o cenário que este teste documenta.
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);

    montar();
    await screen.findByText(porTextoDaLinha('const a = 1;'));

    const minimapa = await screen.findByRole('button', { name: /Minimapa/i });
    expect(minimapa).toBeInTheDocument();
    expect(minimapa.querySelector('canvas')).toBeInTheDocument();
    erro.mockRestore();
  });
});

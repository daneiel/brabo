import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
// A instância REAL do app, como em `ModelPicker.test.tsx`.
import i18n from '../lib/i18n';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { Model, ModelsByCategory, SessionResponseLanguage } from '../lib/api-types';
import {
  LARGURA_DA_BARRA_COMPACTA,
  LARGURA_DA_BARRA_COMPLETA,
  modoDaBarra,
} from '../lib/modo-da-barra-da-sessao';
import { SessionTopbar, type SessionTopbarProps } from './SessionTopbar';

/**
 * A barra do topo da Sessão pela largura que ela TEM (AT-317).
 *
 * O defeito medido: a 1440px (barra de ~1176px) o chip do modelo cobria
 * "Respostas:", o seletor e a origem do idioma cortavam, "Iniciar ideação"
 * quebrava em duas linhas e o título cortava; a 1024px o título virava "S".
 *
 * O que pode dar errado na correção: a barra estreita ESCONDER a informação em
 * vez de movê-la (a RN-620 exige idioma E origem), a pergunta da detecção
 * (RN-624) sumir atrás de um clique, o botão destrutivo perder o nome, e a
 * largura desconhecida (jsdom, primeira pintura) virar "estreita".
 */

const getSessionResponseLanguage = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a href="#" className={className}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: () => ({
    data: { workspace: { id: 'w1' }, role: 'developer' },
  }),
}));

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ...real,
    getSessionResponseLanguage: (...args: unknown[]) => getSessionResponseLanguage(...args),
    setSessionResponseLanguage: vi.fn(),
    answerDetectedLanguage: vi.fn(),
    setSessionModelBinding: vi.fn(),
  };
});

// ResizeObserver de mentira: guarda o callback para o teste entregar a largura
// que quiser — jsdom não faz layout, então não há largura real a medir.
type Callback = (entradas: Array<{ contentRect: { width: number } }>) => void;
let observadores: Callback[] = [];
class ResizeObserverFalso {
  private cb: Callback;
  constructor(cb: Callback) {
    this.cb = cb;
    observadores.push(cb);
  }
  observe() {}
  disconnect() {
    observadores = observadores.filter((c) => c !== this.cb);
  }
}

function larguraDaBarra(width: number) {
  act(() => {
    for (const cb of observadores) cb([{ contentRect: { width } }]);
  });
}

function model(over: Partial<Model> = {}): Model {
  return {
    id: 'm-qwen',
    provider: 'ollama',
    name: 'qwen2.5-coder:7b',
    displayName: 'Qwen2.5 Coder 7B (local)',
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    contextWindow: 8192,
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsReasoning: false,
    generatesImage: false,
    supportsVision: false,
    manualPricing: true,
    availability: 'available',
    lastSeenAt: null,
    ...over,
  };
}

const MODELOS: ModelsByCategory = { local: { ollama: [model()] }, cloud: {} } as ModelsByCategory;

const IDIOMA: SessionResponseLanguage = {
  language: 'pt-BR',
  origin: 'interface',
  sessionOverride: null,
  account: 'automatico',
  detected: null,
  interfaceLocale: 'pt-BR',
  detectionQuestion: null,
};

function montar(over: Partial<SessionTopbarProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: SessionTopbarProps = {
    projectId: 'p1',
    sessionId: 's1',
    session: { id: 's1', status: 'active', name: null } as SessionTopbarProps['session'],
    rascunhoDoNome: null,
    setRascunhoDoNome: vi.fn(),
    handleRename: vi.fn(),
    hashtag: '#0a9a882b',
    rotulo: '#0a9a882b',
    metaDaSessao: 'Core API · #0a9a882b',
    tipo: undefined,
    modelsByCategory: MODELOS,
    resolvedBinding: { modelId: 'm-qwen' } as SessionTopbarProps['resolvedBinding'],
    budget: undefined,
    queryClient: client,
    isActive: true,
    sessaoCriativa: true,
    criativoActive: false,
    conviteVisivel: false,
    handleStartIdeation: vi.fn(),
    handleClose: vi.fn(),
    asideOpen: true,
    setAsideOpen: vi.fn(),
    ...over,
  };
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionTopbar {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  getSessionResponseLanguage.mockReset();
  getSessionResponseLanguage.mockResolvedValue(IDIOMA);
  observadores = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('modoDaBarra — a régua pura', () => {
  it('largura desconhecida é a barra completa, o comportamento de antes', () => {
    expect(modoDaBarra(null)).toBe('completa');
  });

  it('as duas fronteiras: completa, compacta e mínima', () => {
    expect(modoDaBarra(LARGURA_DA_BARRA_COMPLETA)).toBe('completa');
    expect(modoDaBarra(LARGURA_DA_BARRA_COMPLETA - 1)).toBe('compacta');
    expect(modoDaBarra(LARGURA_DA_BARRA_COMPACTA)).toBe('compacta');
    expect(modoDaBarra(LARGURA_DA_BARRA_COMPACTA - 1)).toBe('minima');
  });

  it('a barra de 1440px com o menu aberto (~1176px) NÃO é completa — era onde transbordava', () => {
    expect(modoDaBarra(1176)).toBe('compacta');
    // e a de 1024px (~760px) é a mínima, onde o título virava "S"
    expect(modoDaBarra(760)).toBe('minima');
  });
});

describe('SessionTopbar pela largura (AT-317)', () => {
  it('sem ResizeObserver (jsdom) a barra fica completa: modelo e idioma em linha, pista visível', async () => {
    montar();
    await screen.findByTestId('origem-do-idioma');
    expect(screen.queryByTestId('ajustes-da-sessao')).toBeNull();
    expect(screen.getByText('Qwen2.5 Coder 7B (local)')).toBeTruthy();
    expect(screen.getByText('traz o Criativo pra conversa')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Encerrar/ }).textContent).toContain('Encerrar');
  });

  it('a 1176px agrupa modelo + idioma num controle com resumo, e o painel traz o idioma COM a origem', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverFalso);
    montar();
    larguraDaBarra(1176);

    const gatilho = screen.getByTestId('ajustes-da-sessao');
    // Fora da linha: nem o seletor de modelo nem o indicador ficam na barra.
    expect(screen.queryByTestId('idioma-da-sessao')).toBeNull();
    expect(screen.queryByText('traz o Criativo pra conversa')).toBeNull();
    // O resumo diz o modelo e, quando chega, o idioma.
    await vi.waitFor(() => expect(gatilho.textContent).toContain('pt-BR'));
    expect(gatilho.textContent).toContain('Qwen2.5 Coder 7B (local)');
    expect(gatilho.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(gatilho);
    expect(gatilho.getAttribute('aria-expanded')).toBe('true');
    const painel = screen.getByTestId('painel-dos-ajustes');
    expect(painel.getAttribute('role')).toBe('dialog');
    const indicador = within(painel).getByTestId('idioma-da-sessao');
    expect(indicador.getAttribute('data-modo')).toBe('painel');
    // RN-620: idioma E origem, por extenso.
    const origem = await within(painel).findByTestId('origem-do-idioma');
    expect(origem.textContent).toMatch(/idioma da interface/);
    // O seletor de modelo de sempre, dentro do painel.
    expect(within(painel).getByText('Qwen2.5 Coder 7B (local)')).toBeTruthy();
    // O botão da ideação continua com o texto inteiro e o `title` da pista.
    const iniciar = screen.getByRole('button', { name: 'Iniciar ideação' });
    expect(iniciar.getAttribute('title')).toMatch(/Criativo/);

    // Esc fecha e devolve o foco ao gatilho.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('painel-dos-ajustes')).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it('clique fora fecha o painel', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverFalso);
    montar();
    larguraDaBarra(1176);
    fireEvent.click(screen.getByTestId('ajustes-da-sessao'));
    expect(screen.getByTestId('painel-dos-ajustes')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('painel-dos-ajustes')).toBeNull();
  });

  it('a 760px o controle fica só com o ícone e "Encerrar" vira ícone — os dois com nome acessível', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverFalso);
    montar();
    larguraDaBarra(760);

    const gatilho = screen.getByTestId('ajustes-da-sessao');
    await vi.waitFor(() =>
      expect(gatilho.getAttribute('aria-label')).toContain('pt-BR'),
    );
    expect(gatilho.textContent).toBe('');
    expect(gatilho.getAttribute('aria-label')).toContain('Qwen2.5 Coder 7B (local)');

    const encerrar = screen.getByRole('button', { name: 'Encerrar a sessão' });
    expect(encerrar.textContent).toBe('');
    expect(encerrar.getAttribute('title')).toBe('Encerrar a sessão');
    // O título segue lá, inteiro no DOM (as reticências são do CSS) e no `title`.
    const titulo = screen.getByRole('button', { name: /Sessão #0a9a882b/ });
    expect(titulo.getAttribute('title')).toMatch(/#0a9a882b/);
  });

  it('pergunta de idioma pendente marca o controle e aparece no painel (RN-624)', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverFalso);
    getSessionResponseLanguage.mockResolvedValue({ ...IDIOMA, detectionQuestion: 'es' });
    montar();
    larguraDaBarra(1176);

    await screen.findByTestId('marca-pergunta-de-idioma');
    const gatilho = screen.getByTestId('ajustes-da-sessao');
    expect(gatilho.getAttribute('aria-label')).toMatch(/pergunta sobre o idioma/);
    fireEvent.click(gatilho);
    expect(
      await within(screen.getByTestId('painel-dos-ajustes')).findByTestId(
        'pergunta-do-idioma-detectado',
      ),
    ).toBeTruthy();
  });

  it('falha ao ler o idioma: o controle segue com o modelo, sem inventar idioma, e o painel diz a falha', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverFalso);
    getSessionResponseLanguage.mockRejectedValue(new Error('500'));
    montar();
    larguraDaBarra(1176);

    const gatilho = screen.getByTestId('ajustes-da-sessao');
    expect(gatilho.textContent).toBe('Qwen2.5 Coder 7B (local)');
    expect(screen.queryByTestId('marca-pergunta-de-idioma')).toBeNull();
    fireEvent.click(gatilho);
    expect(
      await within(screen.getByTestId('painel-dos-ajustes')).findByText(
        'Idioma das respostas indisponível',
      ),
    ).toBeTruthy();
  });

  it('voltar a alargar devolve tudo à linha', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverFalso);
    montar();
    larguraDaBarra(760);
    expect(screen.getByTestId('ajustes-da-sessao')).toBeTruthy();
    larguraDaBarra(LARGURA_DA_BARRA_COMPLETA);
    expect(screen.queryByTestId('ajustes-da-sessao')).toBeNull();
    expect(await screen.findByTestId('idioma-da-sessao')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Encerrar/ }).textContent).toContain('Encerrar');
  });
});

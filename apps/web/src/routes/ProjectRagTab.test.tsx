import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import sessionsPtBR from '../locales/pt-BR/sessions.json';
// `ErroDeCarregamento` (namespace `ui`) é filho deste componente — sem o
// namespace aqui, `t('erroDeCarregamento.retry')` cai na chave crua.
import uiPtBR from '../locales/pt-BR/ui.json';
import { ProjectRagTab } from './ProjectRagTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { RagCoverage, RagSearchResult, Role } from '../lib/api-types';

// Instância isolada de i18next, mesmo padrão de `AccountPage.test.tsx`: o
// componente usa `useTranslation('sessions')` e as asserções abaixo já
// existiam em pt-BR, então a instância de teste fica em pt-BR (o inglês é
// coberto pelos próprios JSON de recurso, não por este teste).
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { sessions: sessionsPtBR, ui: uiPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'sessions',
    ns: ['sessions', 'ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

const getRagCoverage = vi.fn();
const searchRag = vi.fn();
const reindexRag = vi.fn();
const listWorkspaces = vi.fn();
const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getRagCoverage: (...args: unknown[]) => getRagCoverage(...args),
    searchRag: (...args: unknown[]) => searchRag(...args),
    reindexRag: (...args: unknown[]) => reindexRag(...args),
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
  };
});

function comPapel(role: Role) {
  return [{ id: 'ws-1', role }];
}

const cobertura: RagCoverage = {
  docs: { filesInRepo: 12, filesIndexed: 10, truncated: false },
  adr: { filesInRepo: 4, filesIndexed: 4, truncated: false },
  session: { sessionsInProject: 3, sessionsIndexed: 2 },
  chunksTotal: 180,
  chunksWithoutVector: 0,
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = novaInstanciaI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ProjectRagTab projectId="p-1" />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getRagCoverage.mockResolvedValue(cobertura);
  listWorkspaces.mockResolvedValue(comPapel('developer'));
});

describe('ProjectRagTab', () => {
  it('caminho feliz: busca um termo e mostra o resultado com a citação', async () => {
    const resultado: RagSearchResult = {
      query: 'gate de pr',
      vectorAvailable: true,
      hits: [
        {
          chunkId: 'chunk-1',
          scope: 'docs',
          content: 'O gate abre quando a área delega.',
          score: 0.6,
          vectorScore: 0.6,
          lexicalScore: null,
          origin: { kind: 'file', sourcePath: 'docs/gates.md' },
        },
      ],
    };
    searchRag.mockResolvedValue(resultado);
    const user = userEvent.setup();
    montar();

    // RTL só casa o texto DIRETO de um elemento (não o `textContent`
    // recursivo) — "10" é o nó de texto próprio do valor de docs indexados,
    // único nesta cobertura (adr=4, sessões indexadas=2).
    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Termo de busca'), 'gate de pr');
    await user.click(screen.getByRole('button', { name: /Buscar/ }));

    expect(await screen.findByText('docs/gates.md')).toBeInTheDocument();
    expect(searchRag).toHaveBeenCalledWith('p-1', { query: 'gate de pr', scopes: undefined });
  });

  it('CASO DE FALHA (degradação honesta): vectorAvailable false avisa em vez de fingir busca híbrida completa (RN-233/252)', async () => {
    searchRag.mockResolvedValue({
      query: 'x',
      vectorAvailable: false,
      vectorUnavailableReason: 'provider fora do ar',
      hits: [],
    } satisfies RagSearchResult);
    const user = userEvent.setup();
    montar();

    // RTL só casa o texto DIRETO de um elemento (não o `textContent`
    // recursivo) — "10" é o nó de texto próprio do valor de docs indexados,
    // único nesta cobertura (adr=4, sessões indexadas=2).
    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Termo de busca'), 'xx');
    await user.click(screen.getByRole('button', { name: /Buscar/ }));

    expect(await screen.findByText(/Busca só por palavra-chave/)).toBeInTheDocument();
    expect(screen.getByText(/provider fora do ar/)).toBeInTheDocument();
  });

  it('termo curto demais não dispara a busca', async () => {
    const user = userEvent.setup();
    montar();
    // RTL só casa o texto DIRETO de um elemento (não o `textContent`
    // recursivo) — "10" é o nó de texto próprio do valor de docs indexados,
    // único nesta cobertura (adr=4, sessões indexadas=2).
    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Termo de busca'), 'x');
    expect(screen.getByRole('button', { name: /Buscar/ })).toBeDisabled();
    expect(searchRag).not.toHaveBeenCalled();
  });

  it('botão de reindexar só aparece para maintainer/owner (RN-238, mesma régua no cliente)', async () => {
    listWorkspaces.mockResolvedValue(comPapel('developer'));
    montar();
    // RTL só casa o texto DIRETO de um elemento (não o `textContent`
    // recursivo) — "10" é o nó de texto próprio do valor de docs indexados,
    // único nesta cobertura (adr=4, sessões indexadas=2).
    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Reindexar agora/ })).not.toBeInTheDocument();
  });

  it('maintainer vê e pode disparar a reindexação', async () => {
    listWorkspaces.mockResolvedValue(comPapel('maintainer'));
    reindexRag.mockResolvedValue({
      docs: { filesScanned: 12, docsChunks: 30, adrChunks: 10, truncated: false, embedding: { available: true, embedded: 40, skipped: 0 } },
      sessions: { total: 3, indexed: 3, chunksCreated: 15 },
      embeddingAvailable: true,
    });
    const user = userEvent.setup();
    montar();

    const botao = await screen.findByRole('button', { name: /Reindexar agora/ });
    await user.click(botao);

    await waitFor(() => expect(reindexRag).toHaveBeenCalledWith('p-1'));
  });

  it('CASO DE FALHA: erro ao carregar a cobertura mostra o motivo e o botão de tentar de novo', async () => {
    getRagCoverage.mockReset();
    getRagCoverage.mockRejectedValue(new Error('falhou'));
    montar();

    expect(await screen.findByText(/Não consegui carregar a cobertura do índice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });
});

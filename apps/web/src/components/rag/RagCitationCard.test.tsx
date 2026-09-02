import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import sessionsPtBR from '../../locales/pt-BR/sessions.json';
import { RagCitationCard } from './RagCitationCard';
import { ApiError } from '../../lib/api-client';
import type { RagSearchHit } from '../../lib/api-types';

const navigate = vi.fn();
const sendRagFeedback = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    sendRagFeedback: (...args: unknown[]) => sendRagFeedback(...args),
  };
});

// Instância isolada de i18next, mesmo padrão de `AccountPage.test.tsx`: o
// componente usa `useTranslation('sessions')` e as asserções abaixo já
// existiam em pt-BR, então a instância de teste fica em pt-BR (o inglês é
// coberto pelos próprios JSON de recurso, não por este teste).
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { sessions: sessionsPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'sessions',
    ns: ['sessions'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montar(hit: RagSearchHit, projectId = 'p-1', searchId?: string | null) {
  const i18n = novaInstanciaI18n();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RagCitationCard hit={hit} projectId={projectId} searchId={searchId} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
  sendRagFeedback.mockReset();
});

function makeHit(overrides: Partial<RagSearchHit> = {}): RagSearchHit {
  return {
    chunkId: 'chunk-1',
    scope: 'docs',
    content: 'O gate de PR abre quando a área delega e o subagente termina.',
    score: 0.74,
    vectorScore: 0.8,
    lexicalScore: 0.2,
    origin: { kind: 'file', sourcePath: 'docs/gates.md', headingPath: ['Gates', 'PR'] },
    ...overrides,
  };
}

describe('RagCitationCard', () => {
  it('caminho feliz: origem de arquivo mostra caminho e a trilha de heading', () => {
    montar(makeHit());

    expect(screen.getByText(/docs\/gates\.md/)).toBeInTheDocument();
    expect(screen.getByText(/Gates › PR/)).toBeInTheDocument();
    expect(screen.getByText(/74% relevância/)).toBeInTheDocument();
    expect(screen.getByText(/vetor 80% · léxico 20%/)).toBeInTheDocument();
  });

  it('caminho feliz: origem de sessão navega até o evento exato ao clicar', async () => {
    const user = userEvent.setup();
    const hit = makeHit({
      scope: 'session',
      origin: { kind: 'session', sessionId: 'sess-1', eventId: 'evt-9', title: 'user:u-1' },
    });
    montar(hit);

    await user.click(screen.getByRole('button', { name: /user:u-1/ }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId: 'p-1', sessionId: 'sess-1' },
      search: { highlightEvent: 'evt-9' },
    });
  });

  it('CASO DE FALHA: sinal ausente (null) aparece como "—", nunca como 0% (RN-234)', () => {
    const hit = makeHit({ vectorScore: null, lexicalScore: null });
    montar(hit);

    expect(screen.getByText(/vetor — · léxico —/)).toBeInTheDocument();
  });

  it('escopo `local` (RN-455, ADR 0113) é `kind: "file"`, mesma renderização de `docs`/`adr`', () => {
    const hit = makeHit({
      scope: 'local',
      origin: { kind: 'file', sourcePath: 'src/index.ts' },
    });
    montar(hit);

    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText(/src\/index\.ts/)).toBeInTheDocument();
  });
  // ------------------------------------------------------- voto (RN-480/088)

  it('sem `searchId`, os controles de voto NÃO aparecem — a api recusaria o voto', () => {
    montar(makeHit(), 'p-1', null);

    expect(screen.queryByRole('button', { name: 'útil' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'irrelevante' })).not.toBeInTheDocument();
  });

  it('caminho feliz: vota útil e o estado PRONTO diz o veredito e o rank', async () => {
    const user = userEvent.setup();
    sendRagFeedback.mockResolvedValue({
      searchId: 'b-1',
      chunkId: 'chunk-1',
      verdict: 'util',
      rank: 3,
    });
    montar(makeHit(), 'p-1', 'b-1');

    await user.click(screen.getByRole('button', { name: 'útil' }));

    await waitFor(() =>
      expect(screen.getByText(/registrado como útil/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/3º nesta busca/)).toBeInTheDocument();
    expect(sendRagFeedback).toHaveBeenCalledWith('p-1', {
      searchId: 'b-1',
      chunkId: 'chunk-1',
      verdict: 'util',
    });
  });

  it('estado CARREGANDO não se confunde com o pronto: enquanto envia, diz que está registrando', async () => {
    const user = userEvent.setup();
    let resolver: (v: unknown) => void = () => {};
    sendRagFeedback.mockImplementation(
      () => new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    montar(makeHit(), 'p-1', 'b-1');

    await user.click(screen.getByRole('button', { name: 'irrelevante' }));

    await waitFor(() => expect(screen.getByText('registrando…')).toBeInTheDocument());
    // Os três estados não colapsam (RN-088): enquanto envia, NÃO diz registrado.
    expect(screen.queryByText(/registrado como/)).not.toBeInTheDocument();

    resolver({ searchId: 'b-1', chunkId: 'chunk-1', verdict: 'irrelevante', rank: 1 });
    await waitFor(() =>
      expect(screen.getByText(/registrado como irrelevante/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('registrando…')).not.toBeInTheDocument();
  });

  it('CASO DE FALHA: recusa da api aparece com a MENSAGEM dela, nunca como sucesso', async () => {
    const user = userEvent.setup();
    sendRagFeedback.mockRejectedValue(
      new ApiError(400, { message: 'busca não existe neste projeto' }),
    );
    montar(makeHit(), 'p-1', 'b-1');

    await user.click(screen.getByRole('button', { name: 'útil' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/busca não existe neste projeto/);
    expect(screen.queryByText(/registrado como/)).not.toBeInTheDocument();
  });
});

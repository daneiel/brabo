import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectInsightsTab } from './ProjectInsightsTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiError } from '../lib/api-client';
import type { PsychologistAnalysis, PsychologistHypothesis } from '../lib/api-types';

const listHypotheses = vi.fn();
const listPsychologistAnalyses = vi.fn();
const reanalyzeSession = vi.fn();

// Mesmo idioma do HypothesisCard.test: o roteador entra como stub, porque o
// que está sob teste é a aba, não a navegação.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

// `importOriginal` porque `ApiError`/`mensagemDaApi` continuam valendo: é deles
// que `ErroDeCarregamento` tira a frase da api e o `trace_id`.
vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    listHypotheses: (...args: unknown[]) => listHypotheses(...args),
    listPsychologistAnalyses: (...args: unknown[]) =>
      listPsychologistAnalyses(...args),
    acceptHypothesis: vi.fn(),
    dismissHypothesis: vi.fn(),
    reanalyzeSession: (...args: unknown[]) => reanalyzeSession(...args),
  };
});

function hipotese(over: Partial<PsychologistHypothesis> = {}): PsychologistHypothesis {
  return {
    id: 'hyp-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    analysisId: 'an-1',
    agenteAlvo: 'dev-api',
    observacao: 'repete a mesma pergunta',
    hipotese: 'contexto insuficiente na instrução',
    sugestao: 'incluir o module_map no prompt',
    confiancaPercent: 70,
    evidenceEventIds: [],
    terminationAnalysis: null,
    status: 'proposed',
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

function analise(over: Partial<PsychologistAnalysis> = {}): PsychologistAnalysis {
  return {
    id: 'an-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    tier: 'leve',
    triggeredBy: 'auto',
    supersedes: null,
    superseded: false,
    supersededAt: null,
    eventCountAtAnalysis: 12,
    costMicros: 4_200,
    hypothesisCount: 1,
    createdAt: '2026-08-02T00:00:00.000Z',
    ...over,
  } as PsychologistAnalysis;
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectInsightsTab projectId="proj-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPsychologistAnalyses.mockResolvedValue([]);
  reanalyzeSession.mockResolvedValue({ ok: true });
});

describe('ProjectInsightsTab — aba própria (achado #15)', () => {
  it('sem hipóteses, explica de onde elas viriam', async () => {
    listHypotheses.mockResolvedValue([]);
    montar();

    expect(
      await screen.findByText(/o Psicólogo analisa cada sessão encerrada/),
    ).toBeTruthy();
  });

  it('conta quantas esperam decisão', async () => {
    listHypotheses.mockResolvedValue([
      hipotese(),
      hipotese({ id: 'hyp-2', status: 'accepted' }),
    ]);
    montar();

    expect(
      await screen.findByText(/2 hipótese\(s\) · 1 aguardando decisão/),
    ).toBeTruthy();
  });

  it('agrupa subagente de área sob o rótulo da área (ADR 0038)', async () => {
    listHypotheses.mockResolvedValue([
      hipotese({ agenteAlvo: 'qa-automacao' }),
      hipotese({ id: 'hyp-2', agenteAlvo: 'qa-performance-seguranca' }),
    ]);
    montar();

    // Duas subespecialidades de QA caem no MESMO grupo, em vez de duas
    // seções soltas que escondem que são a mesma área.
    expect(await screen.findByText('QA')).toBeTruthy();
    expect(screen.queryByText('qa-automacao')).toBeNull();
  });

  it('falha de carregamento NÃO vira "sem hipóteses ainda" (RN-088)', async () => {
    listHypotheses.mockRejectedValue(new Error('limite de requisições excedido'));
    montar();

    expect(
      await screen.findByText('Não foi possível carregar as hipóteses.'),
    ).toBeTruthy();
    expect(
      screen.queryByText(/o Psicólogo analisa cada sessão encerrada/),
    ).toBeNull();
  });

  it('mostra a faixa de análises com o custo da triagem', async () => {
    listHypotheses.mockResolvedValue([hipotese()]);
    listPsychologistAnalyses.mockResolvedValue([analise()]);
    montar();

    expect(await screen.findByText('triagem leve')).toBeTruthy();
    expect(screen.getByText(/12 evento\(s\)/)).toBeTruthy();
  });
});

/**
 * O Psicólogo pode estar pausado GLOBALMENTE (decisão do usuário em
 * 2026-08-10, não bug — ver docs/explanation/backlog.md), mesmo padrão já
 * aplicado à Anamnese (`ProficiencySection`, em ProjectSettingsTab.test.tsx).
 */
describe('ProjectInsightsTab — Psicólogo pausado globalmente', () => {
  beforeEach(() => {
    listHypotheses.mockResolvedValue([hipotese()]);
    listPsychologistAnalyses.mockResolvedValue([analise()]);
  });

  it('reanalisar com sucesso avisa e não desabilita o botão', async () => {
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Reanalisar' }));

    expect(await screen.findByText('Reanálise enfileirada')).toBeTruthy();
    expect(reanalyzeSession).toHaveBeenCalledWith('proj-1', 'sess-1');
    expect(screen.getByRole('button', { name: 'Reanalisar' })).not.toBeDisabled();
  });

  it('503 (desativado globalmente) é distinto de erro genérico: some toast claro, o botão desabilita e a explicação fica na tela', async () => {
    reanalyzeSession.mockRejectedValue(
      new ApiError(503, {
        message:
          'O Psicólogo está desativado globalmente por decisão do usuário — aguardando refinamento futuro.',
        reason: 'psychologist_disabled',
      }),
    );
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Reanalisar' }));

    expect(await screen.findByText('Psicólogo pausado')).toBeTruthy();
    expect(
      screen.getByText(
        'O Psicólogo está desativado globalmente por decisão do usuário — aguardando refinamento futuro.',
      ),
    ).toBeTruthy();

    // Persistente na tela, não só o toast (RN-088) — e o botão para de
    // convidar um clique que sabidamente falha.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reanalisar' })).toBeDisabled(),
    );
    expect(
      screen.getByText(/O Psicólogo está pausado globalmente por decisão do time/),
    ).toBeTruthy();
  });

  it('erro genérico (não 503) não mexe no botão — só o toast de erro comum', async () => {
    reanalyzeSession.mockRejectedValue(new ApiError(500, { message: 'boom' }));
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Reanalisar' }));

    expect(await screen.findByText('Erro')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reanalisar' })).not.toBeDisabled();
  });
});

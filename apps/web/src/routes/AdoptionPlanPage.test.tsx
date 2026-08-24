import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdoptionPlanPage } from './AdoptionPlanPage';
import type { BootstrapPlanEstado } from '../lib/api-types';
// Instância REAL do app (mesmo motivo de `AgentCard.test.tsx`): sem
// `I18nextProvider` no teste, o hook `useTranslation` cai no singleton
// global de `lib/i18n.ts` — as asserções abaixo checam o texto ATUAL em
// português.
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

const adoptRepository = vi.fn();
const approveBootstrapPlan = vi.fn();
const skipBootstrapPlan = vi.fn();
const getBootstrapPlan = vi.fn();
const getBootstrapStatus = vi.fn();
const getProject = vi.fn();

vi.mock('../lib/api-client', () => ({
  // Campo declarado e atribuído no corpo, não parâmetro-propriedade: o
  // `erasableSyntaxOnly` do tsconfig proíbe a forma curta, e ela quebrava o
  // build de produção (`tsc -b`) sem aparecer no `--noEmit` local.
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  adoptRepository: (...a: unknown[]) => adoptRepository(...a),
  approveBootstrapPlan: (...a: unknown[]) => approveBootstrapPlan(...a),
  skipBootstrapPlan: (...a: unknown[]) => skipBootstrapPlan(...a),
  getBootstrapPlan: (...a: unknown[]) => getBootstrapPlan(...a),
  getBootstrapStatus: (...a: unknown[]) => getBootstrapStatus(...a),
  getProject: (...a: unknown[]) => getProject(...a),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: { items: [] } }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

const PLANO_COM_DIVERGENCIA: BootstrapPlanEstado = {
  plan: {
    generatedAt: '2026-08-02T00:00:00.000Z',
    steps: [
      {
        step: 'create_rc_branch',
        actionType: 'git_branch_create',
        payload: { branchName: 'rc', fromRef: 'qa' },
      },
      {
        step: 'protect_branches',
        actionType: 'git_branch_protect',
        payload: { branchName: 'rc' },
      },
      {
        step: 'commit_pr_template',
        actionType: 'git_commit',
        payload: { path: '.github/pull_request_template.md' },
      },
    ],
    diagnostics: [{ kind: 'extra_branch', detail: { branchName: 'develop' } }],
  },
  decision: null,
  decidedAt: null,
  decidedBy: null,
};

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AdoptionPlanPage
        projectId="p-1"
        provider="github"
        externalId="acme/checkout"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  adoptRepository.mockResolvedValue({});
  approveBootstrapPlan.mockResolvedValue({});
  skipBootstrapPlan.mockResolvedValue({});
  getProject.mockResolvedValue({ id: 'p-1', name: 'Checkout', slug: 'checkout' });
  getBootstrapStatus.mockResolvedValue({
    status: 'awaiting_plan_decision',
    sessionId: 's-1',
    failedStep: null,
    lastError: null,
    attempts: 0,
  });
  getBootstrapPlan.mockResolvedValue(PLANO_COM_DIVERGENCIA);
});

describe('AdoptionPlanPage', () => {
  it('adota ao montar e mostra o plano em seções, sem ter alterado nada', async () => {
    montar();

    await waitFor(() => expect(adoptRepository).toHaveBeenCalledTimes(1));
    expect(adoptRepository).toHaveBeenCalledWith('p-1', 'github', {
      externalId: 'acme/checkout',
    });

    expect(await screen.findByText('Branches')).toBeTruthy();
    expect(screen.getByText('Proteções')).toBeTruthy();
    expect(screen.getByText('Arquivos')).toBeTruthy();
    expect(screen.getByText(/Nada foi alterado no repositório/)).toBeTruthy();

    // Nenhuma decisão foi tomada só por abrir a tela.
    expect(approveBootstrapPlan).not.toHaveBeenCalled();
    expect(skipBootstrapPlan).not.toHaveBeenCalled();
  });

  it('a divergência informativa aparece separada dos passos', async () => {
    montar();
    expect(await screen.findByText('Divergências')).toBeTruthy();
    expect(screen.getByText(/develop/)).toBeTruthy();
  });

  it('"Aprovar plano" envia o generatedAt que a tela viu', async () => {
    montar();
    fireEvent.click(await screen.findByText('Aprovar plano'));

    await waitFor(() =>
      expect(approveBootstrapPlan).toHaveBeenCalledWith('p-1', {
        planGeneratedAt: '2026-08-02T00:00:00.000Z',
      }),
    );
    expect(skipBootstrapPlan).not.toHaveBeenCalled();
  });

  it('"Adotar como está" dispensa o bootstrap', async () => {
    montar();
    fireEvent.click(await screen.findByText('Adotar como está'));

    await waitFor(() =>
      expect(skipBootstrapPlan).toHaveBeenCalledWith('p-1', {
        planGeneratedAt: '2026-08-02T00:00:00.000Z',
      }),
    );
    expect(approveBootstrapPlan).not.toHaveBeenCalled();
  });

  it('decidido como está: confirma que nada foi alterado, sem botões de decisão', async () => {
    getBootstrapPlan.mockResolvedValue({
      ...PLANO_COM_DIVERGENCIA,
      decision: 'as_is',
      decidedAt: '2026-08-02T00:01:00.000Z',
      decidedBy: 'u-1',
    });
    montar();

    expect(
      await screen.findByText(/Repositório adotado como está/),
    ).toBeTruthy();
    expect(screen.queryByText('Aprovar plano')).toBeNull();
    expect(screen.queryByText('Adotar como está')).toBeNull();
  });

  it('plano sem passo nenhum: não há o que aprovar', async () => {
    getBootstrapPlan.mockResolvedValue({
      ...PLANO_COM_DIVERGENCIA,
      plan: {
        generatedAt: '2026-08-02T00:00:00.000Z',
        steps: [],
        diagnostics: [],
      },
    });
    montar();

    expect(
      await screen.findByText(/já está como o template espera/),
    ).toBeTruthy();
    expect(screen.getByText('Aprovar plano').closest('button')?.disabled).toBe(
      true,
    );
  });
});

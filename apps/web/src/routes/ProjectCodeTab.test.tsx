import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import codePtBR from '../locales/pt-BR/code.json';
// `ErroDeCarregamento` (namespace `ui`) é filho deste componente — sem o
// namespace aqui, `t('erroDeCarregamento.retry')` cai na chave crua.
import uiPtBR from '../locales/pt-BR/ui.json';
import { ProjectCodeTab } from './ProjectCodeTab';
import type { EstadoDoContainer } from '../lib/api-types';

// Instância isolada de i18next, mesmo padrão de `AccountPage.test.tsx`: o
// componente usa `useTranslation('code')` e as asserções abaixo já existiam
// em pt-BR, então a instância de teste fica em pt-BR.
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { code: codePtBR, ui: uiPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'code',
    ns: ['code', 'ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

const getContainerState = vi.fn();
const getProject = vi.fn();

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getContainerState: (...args: unknown[]) => getContainerState(...args),
    getProject: (...args: unknown[]) => getProject(...args),
  };
});

vi.mock('./code/CodeShell', () => ({
  CodeShell: ({ projectId }: { projectId: string }) => <div>shell aberto para {projectId}</div>,
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = novaInstanciaI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ProjectCodeTab projectId="proj-1" />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const DECIDIDO: EstadoDoContainer = {
  status: 'decidido',
  decisao: {
    image: 'node:22-bookworm-slim',
    rationale: 'projeto todo TypeScript',
    network: 'none',
    resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
  },
  version: 1,
  eventId: 'evt-1',
  decidedAt: '2026-08-09T10:00:00.000Z',
};

const SEM_DECISAO: EstadoDoContainer = {
  status: 'sem_decisao',
  decisao: null,
  version: 0,
  eventId: null,
  decidedAt: null,
};

/**
 * O projeto no modo de sempre. A aba pergunta o modo (RN-169) porque projeto
 * Local não passa pelo gate do container — ele não sobe container nenhum.
 */
function projeto(workspaceMode: 'container' | 'local' = 'container') {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Checkout',
    slug: 'checkout',
    createdBy: 'user-1',
    maxConsecutiveBlocked: null,
    storyPromotion: 'manual' as const,
    workspaceMode,
    workspacePath: workspaceMode === 'local' ? '/home/voce/loja' : null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue(projeto());
});

describe('ProjectCodeTab — o gate (RN-107)', () => {
  it('carregando: não mostra nem o bloqueio nem o shell', async () => {
    let liberar: (v: unknown) => void = () => {};
    getContainerState.mockReturnValue(new Promise((resolve) => (liberar = resolve)));

    montar();

    expect(screen.queryByText(/ainda não está liberada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/shell aberto/)).not.toBeInTheDocument();

    liberar(DECIDIDO);
    expect(await screen.findByText('shell aberto para proj-1')).toBeInTheDocument();
  });

  it('erro de carga mostra a mensagem da api, não o editor vazio', async () => {
    getContainerState.mockRejectedValue(new Error('429'));

    montar();

    expect(
      await screen.findByText(/Não consegui verificar se a aba Code está liberada/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/shell aberto/)).not.toBeInTheDocument();
  });

  it('sem_decisao: o QUARTO estado — nem carregando, nem erro, nem vazio', async () => {
    getContainerState.mockResolvedValue(SEM_DECISAO);

    montar();

    expect(
      await screen.findByText('A aba Code ainda não está liberada'),
    ).toBeInTheDocument();
    expect(screen.getByText(/o Arquiteto ainda não decidiu/i)).toBeInTheDocument();
    expect(screen.queryByText(/shell aberto/)).not.toBeInTheDocument();
  });

  it('decidido: abre o shell de verdade, não o bloqueio', async () => {
    getContainerState.mockResolvedValue(DECIDIDO);

    montar();

    expect(await screen.findByText('shell aberto para proj-1')).toBeInTheDocument();
    expect(screen.queryByText(/ainda não está liberada/)).not.toBeInTheDocument();
  });

  /**
   * Projeto Local (RN-169, ADR 0072): a api já libera a leitura, e a tela tem
   * de concordar. Sem isto a aba ficaria bloqueada para sempre esperando uma
   * decisão que ninguém vai tomar — e nem sequer há o que perguntar, por isso
   * `getContainerState` não é chamado.
   */
  it('projeto Local: abre o shell sem sequer perguntar do container', async () => {
    getProject.mockResolvedValue(projeto('local'));
    getContainerState.mockResolvedValue(SEM_DECISAO);

    montar();

    expect(await screen.findByText('shell aberto para proj-1')).toBeInTheDocument();
    expect(screen.queryByText(/ainda não está liberada/)).not.toBeInTheDocument();
    expect(getContainerState).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ProjectCodeTab } from './ProjectCodeTab';
import type { EstadoDoContainer } from '../lib/api-types';

const getContainerState = vi.fn();

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getContainerState: (...args: unknown[]) => getContainerState(...args),
  };
});

vi.mock('./code/CodeShell', () => ({
  CodeShell: ({ projectId }: { projectId: string }) => <div>shell aberto para {projectId}</div>,
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectCodeTab projectId="proj-1" />
    </QueryClientProvider>,
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

beforeEach(() => {
  vi.clearAllMocks();
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
});

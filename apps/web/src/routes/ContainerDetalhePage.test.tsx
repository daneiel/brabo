import type React from 'react';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { ContainerDetalhePage } from './ContainerDetalhePage';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { ContainerOverviewItem } from '../lib/api-types';
import i18n from '../lib/i18n';
import { INTERVALO_DO_PROJETO_MS } from '../lib/canal-vivo';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

const getRunInstructions = vi.fn();
vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return { ...original, getRunInstructions: (...a: unknown[]) => getRunInstructions(...a) };
});

const useContainersOverview = vi.fn();
vi.mock('../lib/hooks', () => ({
  useContainersOverview: (...a: unknown[]) => useContainersOverview(...a),
  useCurrentWorkspaceWithRole: () => ({
    data: { workspace: { id: 'ws-1', name: 'Acme', slug: 'acme' }, role: 'maintainer' },
  }),
  useLatestSession: () => ({ latest: undefined }),
}));
vi.mock('../lib/auth', () => ({ userIdDaSessao: () => 'u', emailDaSessao: () => null }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'proj-1' }),
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

function item(o: Partial<ContainerOverviewItem> = {}): ContainerOverviewItem {
  return {
    projectId: 'proj-1',
    projectName: 'core',
    projectSlug: 'core',
    executionMode: 'container',
    registrado: {
      status: 'running',
      imageVersion: 2,
      imagem: 'node:22',
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      failureReason: null,
      createdAt: '2026-08-01T10:00:00.000Z',
      statusChangedAt: '2026-08-01T10:05:00.000Z',
    },
    temImagemDecidida: true,
    workspaceVerifiedAt: null,
    observado: null,
    naoObservado: 'broker-sem-resposta',
    detalheDaObservacao: null,
    naoVerificado: null,
    acaoPendente: null,
    brokerConfigurado: true,
    decisaoVigente: { version: 2, image: 'node:22', network: 'egress' },
    imagemDesatualizada: false,
    ...o,
  };
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ContainerDetalhePage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const run = (urls: { label: string; url: string }[]) => ({
  command: 'docker compose up',
  urls,
  envExample: false,
  prUrl: 'http://localhost/pr',
  version: 1,
  eventId: 'e',
  declaredAt: '2026-10-11T12:00:00.000Z',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContainerDetalhePage', () => {
  it('mostra registrado e observado separados, rede e URLs declaradas não verificadas', async () => {
    useContainersOverview.mockReturnValue({ isPending: false, isError: false, data: [item()] });
    getRunInstructions.mockResolvedValue(run([{ label: 'web', url: 'http://localhost:3000' }]));
    montar();
    expect(await screen.findByText('Com saída para a internet')).toBeTruthy();
    expect(screen.getByText(/node:22 · v2/)).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'http://localhost:3000' })).toBeTruthy();
    expect(screen.getByText(/não verificadas/)).toBeTruthy();
    // ritmo de projeto, nunca os 5s da lista (RN-579/RN-632)
    expect(useContainersOverview).toHaveBeenCalledWith('ws-1', INTERVALO_DO_PROJETO_MS);
    expect(getRunInstructions).toHaveBeenCalledTimes(1);
  });

  it('nunca provisionado e run-instructions vazio têm texto próprio', async () => {
    useContainersOverview.mockReturnValue({
      isPending: false,
      isError: false,
      data: [item({ registrado: null, decisaoVigente: null, naoObservado: null })],
    });
    getRunInstructions.mockResolvedValue(null);
    montar();
    expect(await screen.findByText('Nenhuma URL declarada pela Infra para este projeto.')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('nunca provisionado').length).toBeGreaterThan(0));
  });

  it('projeto fora da lista diz que não achou', async () => {
    useContainersOverview.mockReturnValue({ isPending: false, isError: false, data: [] });
    getRunInstructions.mockResolvedValue(null);
    montar();
    expect(await screen.findByText(/não está na lista/)).toBeTruthy();
  });
});

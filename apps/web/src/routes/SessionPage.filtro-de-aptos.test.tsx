import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { historicoFalso } from '../test/historico-de-eventos';
import type { Model, ModelsByCategory } from '../lib/api-types';

/**
 * O seletor de modelo da SESSÃO abre com "aptos para agentes" DESMARCADO — e
 * essa é a decisão, não a ausência dela.
 *
 * As duas telas de Configurações que gravam em `agent` e em `area` passaram a
 * abrir com o filtro marcado (`settings/filtro-de-aptos.test.tsx`), porque
 * `assertModelFitsBindingScope` recusa modelo chat-only nesses dois escopos e
 * o clique só existia para ser recusado com 422
 * ([RN-040](docs/business-rules/custo.md#rn-040)). Aqui o escopo é `session`, e
 * a mesma função o deixa livre DE PROPÓSITO: quem `exigeToolCalling` é o TURNO
 * — `RunLlmTurnUseCase` só liga a exigência quando há ferramenta na chamada —,
 * não o escopo. Marcar o filtro aqui esconderia modelo que a api aceita, que é
 * o inverso exato do defeito corrigido nas outras duas telas.
 *
 * Este arquivo existe para que a omissão não seja lida como esquecimento e
 * "consertada" numa varredura futura.
 */

const listModels = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: { items: [] } }),
  useSessionEventHistory: () => historicoFalso([]),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: [] }),
  useCurrentWorkspaceWithRole: () => ({ data: undefined }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({ streamChatMessage: vi.fn() }));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));
vi.mock('../lib/auth', () => ({ emailDaSessao: () => 'eu@brabo.dev' }));

vi.mock('../lib/api-client', () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
  getSession: vi.fn().mockResolvedValue(null),
  getSessionBudget: vi.fn().mockResolvedValue(null),
  getSessionModelBinding: vi
    .fn()
    .mockResolvedValue({ modelId: 'm-tools', origin: 'workspace', skipped: [] }),
  listModels: (...args: unknown[]) => listModels(...args),
  renameSession: vi.fn(),
  acceptHandoff: vi.fn(),
  approveAction: vi.fn(),
  approveAlwaysAction: vi.fn(),
  confirmReadiness: vi.fn(),
  denyAction: vi.fn(),
  sendAgentMessage: vi.fn(),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

const TAGARELA = 'Tagarela';

function modelo(over: Partial<Model> = {}): Model {
  return {
    id: 'm-tools',
    provider: 'ollama',
    name: 'tools',
    displayName: 'Com ferramentas',
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

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage projectId="proj-1" sessionId={ID} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listModels.mockResolvedValue({
    local: {
      ollama: [
        modelo(),
        modelo({
          id: 'm-chat',
          name: 'chat',
          displayName: TAGARELA,
          supportsToolCalling: false,
        }),
      ],
    },
    cloud: {},
  } as ModelsByCategory);
});

describe('seletor de modelo da SESSÃO — o filtro NÃO vem marcado', () => {
  it('abre desmarcado e oferece o chat-only, que a api aceita neste escopo', async () => {
    montar();

    fireEvent.click(await screen.findByRole('button', { name: /Com ferramentas/ }));

    expect(await screen.findByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText(TAGARELA)).toBeInTheDocument();
  });
});

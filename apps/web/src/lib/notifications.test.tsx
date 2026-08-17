import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNotificationGroups, useProjectsUnread } from './notifications';
import type { Project, ProjectCardSummary, SessionEvent } from './api-types';

/**
 * Quantos não lidos ficaram FORA da janela do sino — por subtração, não por
 * requisição (RN-100).
 *
 * O total já está no resumo do workspace (`latestSeq` menos o corte, RN-090) e
 * a janela é o que a gaveta devolveu. Perguntar isso à api seria uma segunda
 * consulta para descobrir algo que a primeira já tinha respondido.
 */

const { eventosPorProjeto } = vi.hoisted(() => ({
  eventosPorProjeto: { quantos: 0 },
}));

function evento(seq: number): SessionEvent {
  return {
    id: `evt-${seq}`,
    sessionId: 'sess-1',
    seq,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: {},
    createdAt: new Date(seq * 1000).toISOString(),
  };
}

vi.mock('./api-client', async () => {
  const real = await vi.importActual<typeof import('./api-client')>('./api-client');
  return {
    ...real,
    getUnreadEvents: (
      _ws: string,
      cursors: { projectId: string; afterSeq: number }[],
    ) =>
      Promise.resolve(
        cursors.map((c) => ({
          projectId: c.projectId,
          sessionId: 'sess-1',
          // Do mais novo para o mais antigo, como a api devolve.
          events: Array.from({ length: eventosPorProjeto.quantos }, (_, i) =>
            evento(300 - i),
          ),
        })),
      ),
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const projeto: Project = {
  id: 'p-1',
  workspaceId: 'ws-1',
  name: 'Acme',
  slug: 'acme',
  createdBy: 'user-1',
  maxConsecutiveBlocked: null,
  storyPromotion: 'manual',
  workspaceMode: 'container',
  workspacePath: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function resumo(latestSeq: number): ProjectCardSummary {
  return {
    projectId: 'p-1',
    provider: 'github',
    provisioningStatus: 'provisioned',
    budget: null,
    latestSessionId: 'sess-1',
    latestSeq,
    lastEvent: null,
    storiesAwaitingPromotion: 0,
    pendingApprovalsCount: 0,
    roster: {
      executionActivated: false,
      moduleNames: [],
      gatesEverOpened: false,
      delegatedSubagents: [],
      infraActive: false,
      uxDesignerActive: false,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('useNotificationGroups', () => {
  it('conta o que sobrou fora da janela sem uma segunda requisição', async () => {
    eventosPorProjeto.quantos = 50;

    const { result } = renderHook(
      () => {
        const unread = useProjectsUnread([projeto], [resumo(300)]);
        return useNotificationGroups(unread, true, 'ws-1');
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current[0].events).toHaveLength(50));
    expect(result.current[0].unreadCount).toBe(300);
    expect(result.current[0].olderCount).toBe(250);
  });

  it('quando tudo cabe na janela, nada fica de fora', async () => {
    eventosPorProjeto.quantos = 7;

    const { result } = renderHook(
      () => {
        const unread = useProjectsUnread([projeto], [resumo(7)]);
        return useNotificationGroups(unread, true, 'ws-1');
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current[0].events).toHaveLength(7));
    expect(result.current[0].olderCount).toBe(0);
  });

  it('a ordem que a api mandou é a ordem que sai daqui', async () => {
    eventosPorProjeto.quantos = 3;

    const { result } = renderHook(
      () => {
        const unread = useProjectsUnread([projeto], [resumo(300)]);
        return useNotificationGroups(unread, true, 'ws-1');
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current[0].events).toHaveLength(3));
    expect(result.current[0].events.map((e) => e.seq)).toEqual([300, 299, 298]);
  });
});

import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionReadiness } from './session-readiness';
import type { Epic, SessionEvent } from './api-types';

/**
 * Primeiro hook testado isolado (`renderHook`) no repo, fora de
 * `notifications.test.tsx`/`session-history.test.tsx`/
 * `hooks.pausar-poll.test.tsx` — mas sem `QueryClientProvider`: o hook não
 * chama `useQuery` nenhuma, só `useMemo` sobre os dois parâmetros
 * (`events`/`backlogData`), então não precisa de wrapper.
 *
 * Cobertura: caminho feliz (as seis derivações com evidência presente) + 1
 * caso de falha/borda por grupo (RN-160/RN-161), no padrão do repo — não
 * exaustivo.
 */

function evento(
  seq: number,
  type: string,
  payload: unknown = {},
): SessionEvent {
  return {
    id: `evt-${seq}`,
    sessionId: 'sess-1',
    seq,
    type,
    actor: { kind: 'agent', id: 'system' },
    payload,
    createdAt: new Date(seq * 1000).toISOString(),
  };
}

function epic(status: Epic['stories'][number]['status']): Epic {
  return {
    id: 'epic-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'Épico',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stories: [
      {
        id: 'story-1',
        epicId: 'epic-1',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        title: 'História',
        description: '',
        rf: [],
        rnf: [],
        businessRuleIds: [],
        dod: [],
        dor: [],
        status,
        proposedReady: false,
        returnedReason: null,
        returnedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tasks: [],
      },
    ],
  };
}

describe('useSessionReadiness', () => {
  it('deriva os seis sinalizadores a partir dos eventos e do backlog (caminho feliz)', () => {
    const events: SessionEvent[] = [
      evento(1, 'agent.activated', { agent: 'criativo' }),
      evento(2, 'artifact.business_rule'),
      evento(3, 'artifact.product_brief'),
      // Arquiteto entra DEPOIS do Criativo — "mais recente vence".
      evento(4, 'agent.activated', { agent: 'arquiteto' }),
    ];
    const backlogData: Epic[] = [epic('ready')];

    const { result } = renderHook(() =>
      useSessionReadiness(events, backlogData),
    );

    expect(result.current.criativoActive).toBe(true);
    expect(result.current.arquitetoActive).toBe(true);
    expect(result.current.hasBusinessRule).toBe(true);
    expect(result.current.hasPromotedStory).toBe(true);
    expect(result.current.hasProductBrief).toBe(true);
  });

  it('degrada pra falso/null sem nenhuma evidência (sessão nova, backlog undefined)', () => {
    const { result } = renderHook(() => useSessionReadiness([], undefined));

    expect(result.current.criativoActive).toBe(false);
    expect(result.current.arquitetoActive).toBe(false);
    expect(result.current.hasBusinessRule).toBe(false);
    expect(result.current.hasPromotedStory).toBe(false);
    expect(result.current.hasProductBrief).toBe(false);
  });

  it('hasPromotedStory exige status diferente de draft — épico só com draft não conta', () => {
    const { result } = renderHook(() =>
      useSessionReadiness([], [epic('draft')]),
    );

    expect(result.current.hasPromotedStory).toBe(false);
  });
});

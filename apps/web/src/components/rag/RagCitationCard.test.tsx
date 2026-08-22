import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RagCitationCard } from './RagCitationCard';
import type { RagSearchHit } from '../../lib/api-types';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockClear();
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
    render(<RagCitationCard hit={makeHit()} projectId="p-1" />);

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
    render(<RagCitationCard hit={hit} projectId="p-1" />);

    await user.click(screen.getByRole('button', { name: /user:u-1/ }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId: 'p-1', sessionId: 'sess-1' },
      search: { highlightEvent: 'evt-9' },
    });
  });

  it('CASO DE FALHA: sinal ausente (null) aparece como "—", nunca como 0% (RN-234)', () => {
    const hit = makeHit({ vectorScore: null, lexicalScore: null });
    render(<RagCitationCard hit={hit} projectId="p-1" />);

    expect(screen.getByText(/vetor — · léxico —/)).toBeInTheDocument();
  });
});

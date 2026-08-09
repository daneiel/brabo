import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HypothesisCard } from './HypothesisCard';
import type { PsychologistHypothesis } from '../lib/api-types';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockClear();
});

function makeHypothesis(
  overrides: Partial<PsychologistHypothesis> = {},
): PsychologistHypothesis {
  return {
    id: 'hyp-1',
    projectId: 'project-1',
    // Sessão ANALISADA — de propósito diferente de qualquer sessão aberta,
    // pra o teste provar que a navegação aponta pra ela.
    sessionId: 'session-analisada',
    analysisId: 'analysis-1',
    agenteAlvo: 'dev-api',
    observacao: 'pediu ajuda três vezes na mesma task',
    hipotese: 'o DoR da story estava ambíguo',
    sugestao: 'exigir critério de aceite explícito antes do ready',
    confiancaPercent: 78,
    evidenceEventIds: ['01JEVT0000000000000000AAAA'],
    terminationAnalysis: null,
    status: 'proposed',
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderCard(hypothesis = makeHypothesis(), handlers = {}) {
  const onAccept = vi.fn();
  const onDismiss = vi.fn();
  render(
    <HypothesisCard
      hypothesis={hypothesis}
      projectId="project-1"
      onAccept={onAccept}
      onDismiss={onDismiss}
      {...handlers}
    />,
  );
  return { onAccept, onDismiss };
}

describe('HypothesisCard', () => {
  it('mostra a confiança e a hipótese', () => {
    renderCard();

    expect(screen.getByText('78% de confiança')).toBeTruthy();
    expect(screen.getByText('o DoR da story estava ambíguo')).toBeTruthy();
  });

  it('chip de evidência navega até o evento na sessão ANALISADA', () => {
    renderCard();

    // O chip mostra os últimos 8 caracteres do event id.
    fireEvent.click(screen.getByRole('button', { name: '000000AAAA'.slice(-8) }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId: 'project-1', sessionId: 'session-analisada' },
      search: { highlightEvent: '01JEVT0000000000000000AAAA' },
    });
  });

  it('um chip por evidência', () => {
    renderCard(
      makeHypothesis({ evidenceEventIds: ['evt-aaaaaaaa', 'evt-bbbbbbbb'] }),
    );

    expect(screen.getByRole('button', { name: 'aaaaaaaa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'bbbbbbbb' })).toBeTruthy();
  });

  it('aceitar/descartar disponíveis enquanto proposta', () => {
    const { onAccept, onDismiss } = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
    expect(onAccept).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('hipótese já decidida não oferece as ações de novo', () => {
    renderCard(makeHypothesis({ status: 'accepted' }));

    expect(screen.getByText('aceita')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull();
  });

  it('término anormal ganha a seção de causa e estado da sessão', () => {
    renderCard(
      makeHypothesis({
        terminationAnalysis: {
          causa: 'timeout',
          estadoDaSessao: 'aguardando aprovação de PR',
          analise: 'ninguém reconectou e a task ficou em aberto',
        },
      }),
    );

    expect(screen.getByText(/Término anormal · timeout/)).toBeTruthy();
    expect(
      screen.getByText('ninguém reconectou e a task ficou em aberto'),
    ).toBeTruthy();
    expect(
      screen.getByText(/Estado no momento: aguardando aprovação de PR/),
    ).toBeTruthy();
  });

  it('sem término anormal a seção não aparece', () => {
    renderCard();
    expect(screen.queryByText(/Término anormal/)).toBeNull();
  });

  /**
   * FASE 19 (RN-096) — Insights fala a mesma língua das aprovações: a frase de
   * `lib/aprovacoes.ts` diz o que acontece se você aceitar, e a fundamentação
   * desce para o colapso com o mesmo default dos outros dois lugares (abre o
   * que ainda espera decisão).
   */
  describe('frase e colapso', () => {
    it('diz o que acontece ao aceitar — e não promete o que o accept não faz', () => {
      renderCard();

      const frase = screen.getByText(/Aceitar manda esta hipótese/);
      // Aceitar enfileira para a Anamnese; o ajuste da instrução ainda vem
      // para aprovação. Prometer "a instrução será alterada" seria mentira.
      expect(frase.textContent).toContain('Anamnese');
      expect(frase.textContent).toContain('aprovar');
    });

    it('proposta: a fundamentação nasce ABERTA — é ela que sustenta a decisão', () => {
      renderCard();

      const cabecalho = screen.getByRole('button', { name: /No que o Psicólogo se baseou/ });
      expect(cabecalho.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('pediu ajuda três vezes na mesma task')).toBeTruthy();
    });

    it('decidida: nasce FECHADA, e a frase diz o desfecho', () => {
      renderCard(makeHypothesis({ status: 'dismissed' }));

      const cabecalho = screen.getByRole('button', { name: /No que o Psicólogo se baseou/ });
      expect(cabecalho.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('pediu ajuda três vezes na mesma task')).toBeNull();
      expect(screen.getByText(/nada mudou na instrução/)).toBeTruthy();
    });

    it('fechada, abrir revela a fundamentação inteira', () => {
      renderCard(makeHypothesis({ status: 'accepted' }));

      fireEvent.click(screen.getByRole('button', { name: /No que o Psicólogo se baseou/ }));
      expect(screen.getByText('pediu ajuda três vezes na mesma task')).toBeTruthy();
      expect(
        screen.getByText('exigir critério de aceite explícito antes do ready'),
      ).toBeTruthy();
    });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionEvent } from '../lib/api-types';
import i18n from '../lib/i18n';

const resumeInterruptedTurn = vi.fn();
const showToast = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return { ...original, resumeInterruptedTurn: (...a: unknown[]) => resumeInterruptedTurn(...a) };
});
vi.mock('../components/ui/ToastProvider', () => ({
  useToast: () => ({ showToast }),
}));

const { RetomarTurnoInterrompido, turnoInterrompidoPendente, planoVigente, ehRetomadaAutomatica } =
  await import('./RetomarTurnoInterrompido');
const { ApiError } = await import('../lib/api-client');

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});
beforeEach(() => vi.clearAllMocks());

const ev = (seq: number, type: string, payload: unknown): SessionEvent =>
  ({
    id: `e${seq}`,
    sessionId: 's1',
    seq,
    type,
    actor: { kind: 'agent', id: 'po' },
    payload,
    createdAt: new Date().toISOString(),
  }) as SessionEvent;

const plano = ev(1, 'agent.plan', {
  objetivo: 'Cobrir o backlog',
  passos: [
    { texto: 'Ler regras', estado: 'feito' },
    { texto: 'Escrever histórias', estado: 'em_curso' },
  ],
});
const erro = ev(2, 'agent.error', { reason: 'turno_interrompido_por_reinicio' });

describe('turnoInterrompidoPendente', () => {
  it('pendente até algo seguir; retomada ou turno novo apagam o cartão', () => {
    expect(turnoInterrompidoPendente([plano, erro], erro)).toBe(true);
    const retomado = ev(3, 'agent.turn_resumed', { automatica: true });
    expect(turnoInterrompidoPendente([plano, erro, retomado], erro)).toBe(false);
    expect(ehRetomadaAutomatica(retomado)).toBe(true);
    expect(
      turnoInterrompidoPendente([erro, ev(3, 'agent.status', { status: 'working' })], erro),
    ).toBe(false);
  });

  it('lê o último plano do agente', () => {
    expect(planoVigente([plano, erro], erro)?.passos).toHaveLength(2);
  });
});

function montar(podeDecidir: boolean, acompanhar = vi.fn()) {
  render(
    <RetomarTurnoInterrompido
      projectId="p1"
      sessionId="s1"
      agent="po"
      plano={planoVigente([plano, erro], erro)}
      podeDecidir={podeDecidir}
      acompanhar={acompanhar}
    />,
  );
  return acompanhar;
}

describe('RetomarTurnoInterrompido', () => {
  it('mostra o plano; o clique chama a rota e passa a acompanhar o log', async () => {
    resumeInterruptedTurn.mockResolvedValue({ ok: true });
    const acompanhar = montar(true);
    expect(screen.getByTestId('turno-interrompido-plano').textContent).toContain(
      'Parou em: Escrever histórias',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retomar' }));
    await waitFor(() => expect(acompanhar).toHaveBeenCalledWith('po'));
    expect(resumeInterruptedTurn).toHaveBeenCalledWith('p1', 's1', 'po');
  });

  it('409 mostra a frase da api e não acompanha', async () => {
    resumeInterruptedTurn.mockRejectedValue(new ApiError(409, { message: 'Nada a retomar' }));
    const acompanhar = montar(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retomar' }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0]![0].message).toContain('Nada a retomar');
    expect(acompanhar).not.toHaveBeenCalled();
  });

  it('sem papel: vê o plano, o botão fica inerte e o motivo é texto', () => {
    montar(false);
    expect(screen.getByRole('button', { name: 'Retomar' })).toBeDisabled();
    expect(screen.getByTestId('retomar-turno-nota').textContent).toContain('papel developer');
  });
});

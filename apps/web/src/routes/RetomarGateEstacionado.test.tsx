import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionEvent } from '../lib/api-types';
import i18n from '../lib/i18n';

const resumeParkedGate = vi.fn();
const showToast = vi.fn();

vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return { ...original, resumeParkedGate: (...a: unknown[]) => resumeParkedGate(...a) };
});
vi.mock('../components/ui/ToastProvider', () => ({
  useToast: () => ({ showToast }),
}));

const { RetomarGateEstacionado, cicloEstacionado } = await import('./RetomarGateEstacionado');
const { ApiError } = await import('../lib/api-client');

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});
beforeEach(() => vi.clearAllMocks());

const evento = (type: string, payload: unknown): SessionEvent =>
  ({
    id: 'e1',
    sessionId: 's-1',
    seq: 3,
    type,
    actor: { kind: 'system', id: 'gate-rescuer' },
    payload,
    createdAt: new Date().toISOString(),
  }) as SessionEvent;

describe('RetomarGateEstacionado (RN-724)', () => {
  it('lê o ciclo do gate.rescue_parked; outro evento não tem botão', () => {
    expect(cicloEstacionado(evento('gate.rescue_parked', { taskId: 't1', gate: 'qa' }))).toEqual({
      taskId: 't1',
      gate: 'qa',
    });
    expect(cicloEstacionado(evento('gate.opened', { taskId: 't1', gate: 'qa' }))).toBeNull();
    expect(cicloEstacionado(evento('gate.rescue_parked', {}))).toBeNull();
  });

  it('o clique chama a rota de retomar com projeto, tarefa e gate', async () => {
    resumeParkedGate.mockResolvedValue({ ok: true });
    render(<RetomarGateEstacionado projectId="p1" taskId="t1" gate="qa" podeDecidir />);

    fireEvent.click(screen.getByRole('button', { name: 'Retomar gate' }));

    await waitFor(() => expect(resumeParkedGate).toHaveBeenCalledWith('p1', 't1', 'qa'));
    await waitFor(() =>
      expect(screen.getByTestId('retomar-gate-nota')).toHaveTextContent('Gate retomado'),
    );
  });

  it('CASO DE FALHA: a recusa da api (409) vira toast com a frase dela', async () => {
    resumeParkedGate.mockRejectedValue(
      new ApiError(409, { message: 'Este ciclo de gate não está estacionado.' }),
    );
    render(<RetomarGateEstacionado projectId="p1" taskId="t1" gate="qa" podeDecidir />);

    fireEvent.click(screen.getByRole('button', { name: 'Retomar gate' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Este ciclo de gate não está estacionado.',
          tone: 'danger',
        }),
      ),
    );
  });

  it('papel abaixo de developer: botão inerte com o motivo em texto', () => {
    render(<RetomarGateEstacionado projectId="p1" taskId="t1" gate="qa" podeDecidir={false} />);

    expect(screen.getByRole('button', { name: 'Retomar gate' })).toBeDisabled();
    expect(screen.getByTestId('retomar-gate-nota')).toHaveTextContent('exige o papel developer');
  });
});

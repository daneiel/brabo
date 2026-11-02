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

const { RetomarGateEstacionado, cicloEstacionado, cicloInterrompido } =
  await import('./RetomarGateEstacionado');
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

describe('cicloInterrompido (RN-823)', () => {
  it('lê o gate.interrupted; payload sem tarefa ou outro tipo não vira aviso', () => {
    const payload = { taskId: 't1', gate: 'qa', retomadoEm: '2026-10-10T19:00:00Z' };
    expect(cicloInterrompido(evento('gate.interrupted', payload))).toEqual(payload);
    expect(cicloInterrompido(evento('gate.interrupted', { gate: 'qa' }))).toBeNull();
    expect(cicloInterrompido(evento('gate.rescue_parked', { taskId: 't1', gate: 'qa' }))).toBeNull();
  });

  it('o aviso tem texto nos dois idiomas', () => {
    const opcoes = { gate: 'qa', taskId: 't1', hora: '19:00' };
    expect(i18n.t('sessionPage:gateInterrompido.aviso', opcoes)).toContain('reinício do engine');
    expect(i18n.getFixedT('en')('sessionPage:gateInterrompido.aviso', opcoes)).toContain(
      'engine restart',
    );
  });
});

describe('cicloEstacionado: o motivo gravado (RN-867)', () => {
  it('o resgate por tempo grava idadeSegundos e lê como tempo', () => {
    const e = evento('gate.rescue_parked', {
      taskId: 't1',
      gate: 'qa',
      idadeSegundos: 7300,
      motivo: 'ciclo parado há mais de 120 min sem atividade',
    });
    expect(cicloEstacionado(e)?.motivo).toBe('tempo');
  });

  it('a pergunta em aberto não tem idadeSegundos e não fala em 2 h', () => {
    const e = evento('gate.rescue_parked', {
      taskId: 't1',
      gate: 'qa',
      motivo: 'esperando a decisão do usuário numa pergunta em aberto; a resposta retoma o gate',
    });
    expect(cicloEstacionado(e)?.motivo).toBe('pergunta');
    const texto = i18n.t('sessionPage:gateEstacionado.avisoPergunta', { gate: 'qa', taskId: 't1' });
    expect(texto).toContain('Perguntas em aberto');
    expect(texto).not.toContain('2 h');
  });
});

describe('RetomarGateEstacionado (RN-724)', () => {
  it('lê o ciclo do gate.rescue_parked; outro evento não tem botão', () => {
    expect(cicloEstacionado(evento('gate.rescue_parked', { taskId: 't1', gate: 'qa' }))).toEqual({
      taskId: 't1',
      gate: 'qa',
      motivo: 'pergunta',
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

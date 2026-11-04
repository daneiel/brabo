import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SessionEvent } from '../lib/api-types';
import i18n from '../lib/i18n';
import { montarTimeline, type ContextoDaTimeline } from './session-timeline-montagem';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

// RN-994: a pergunta vem depois da mensagem do agente que a introduz.
const ev = (id: string, seq: number, type: string, kind: 'agent' | 'user', actor: string, payload: unknown = {}) =>
  ({ id, seq, type, actor: { kind, id: actor }, payload, createdAt: '2026-11-03T12:00:00.000Z' }) as SessionEvent;
const pergunta = (id: string, seq: number) =>
  ev(id, seq, 'chat.structured_question', 'agent', 'po', { questions: [] });
const resposta = (id: string, seq: number) =>
  ev(id, seq, 'agent.response', 'agent', 'po', { content: id });
const fala = (id: string, seq: number) => ev(id, seq, 'chat.message', 'user', 'u1', { text: id });

function chaves(eventos: SessionEvent[]) {
  const nada = vi.fn();
  const ctx = {
    events: eventos, actions: [], backlogQuery: { data: undefined }, projectId: 'p1', sessionId: 's1',
    t: i18n.getFixedT('pt-BR', 'sessionPage'),
    autoria: { meuId: null, meuEmail: null, membros: undefined }, queryClient: {} as never,
    invalidateActions: nada, ofertasAcionaveis: [], isActive: true, semRepositorio: false,
    promovendoStoryId: null, promovendoTodas: false, ativandoExecucao: false, podeAtivarAutoMode: false,
    podeDecidir: true, setRecusandoStory: nada, setMotivoRecusa: nada, handlePromoteStory: nada,
    handlePromoteAll: nada, handleAcceptHandoff: nada, handleActivateExecution: nada,
    handleActivateAutoMode: nada, iniciarTurnoDoAgente: nada, acompanharTurnoPeloLog: nada,
    finalizarTurnoDoAgente: nada,
  } as unknown as ContextoDaTimeline;
  return montarTimeline(ctx).map((e) => String((e.node as { key?: string | null })?.key ?? ''));
}
const pos = (k: string[], id: string) => k.findIndex((x) => x.startsWith(id));

describe('montarTimeline — pergunta depois da resposta (RN-994)', () => {
  it('pergunta no meio do turno: a resposta vem antes do cartão', () => {
    const k = chaves([fala('m1', 1), pergunta('q1', 2), resposta('r1', 3)]);
    expect(pos(k, 'r1')).toBeGreaterThanOrEqual(0);
    expect(pos(k, 'r1')).toBeLessThan(pos(k, 'q1'));
  });

  it('turno em curso sem resposta: o cartão fica onde está', () => {
    const k = chaves([fala('m1', 1), pergunta('q1', 2)]);
    expect(pos(k, 'm1')).toBeLessThan(pos(k, 'q1'));
  });

  it('duas perguntas: as duas depois da resposta, na ordem original', () => {
    const k = chaves([fala('m1', 1), pergunta('q1', 2), pergunta('q2', 3), resposta('r1', 4)]);
    expect(pos(k, 'r1')).toBeLessThan(pos(k, 'q1'));
    expect(pos(k, 'q1')).toBeLessThan(pos(k, 'q2'));
  });

  it('não pula para a resposta do turno seguinte', () => {
    const k = chaves([fala('m1', 1), pergunta('q1', 2), fala('m2', 3), resposta('r2', 4)]);
    expect(pos(k, 'q1')).toBeLessThan(pos(k, 'm2'));
    expect(pos(k, 'q1')).toBeLessThan(pos(k, 'r2'));
  });
});

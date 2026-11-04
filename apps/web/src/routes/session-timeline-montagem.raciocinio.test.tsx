import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SessionEvent } from '../lib/api-types';
import i18n from '../lib/i18n';
import { montarTimeline, type ContextoDaTimeline } from './session-timeline-montagem';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

/**
 * A bolha de `agent.error` carrega um seletor ESTRUTURAL — `data-testid` e a
 * ORIGEM em `data-origem` — para o E2E da AT-338
 * (`e2e/testes/turno-pelo-canal.spec.ts`) achá-la sem ler texto, que muda com
 * o idioma da conta.
 */

function resposta(payload: Record<string, unknown>): SessionEvent {
  return {
    id: 'e1',
    seq: 1,
    type: 'agent.response',
    actor: { kind: 'agent', id: 'criativo' },
    payload,
    createdAt: '2026-09-30T12:00:00.000Z',
  } as SessionEvent;
}

function ctxDe(eventos: SessionEvent[], extra: Record<string, unknown> = {}) {
  const nada = vi.fn();
  const ctx = {
    events: eventos,
    actions: [],
    backlogQuery: { data: undefined },
    projectId: 'p1',
    sessionId: 's1',
    t: i18n.getFixedT('pt-BR', 'sessionPage'),
    autoria: { meuId: null, meuEmail: null, membros: undefined },
    queryClient: {} as never,
    invalidateActions: nada,
    ofertasAcionaveis: [],
    isActive: true,
    semRepositorio: false,
    promovendoStoryId: null,
    promovendoTodas: false,
    ativandoExecucao: false,
    podeAtivarAutoMode: false,
    podeDecidir: true,
    setRecusandoStory: nada,
    setMotivoRecusa: nada,
    handlePromoteStory: nada,
    handlePromoteAll: nada,
    handleAcceptHandoff: nada,
    handleActivateExecution: nada,
    handleActivateAutoMode: nada,
    iniciarTurnoDoAgente: nada,
    acompanharTurnoPeloLog: nada,
    finalizarTurnoDoAgente: nada,
    ...extra,
  } as unknown as ContextoDaTimeline;
  return ctx;
}

function montar(eventos: SessionEvent[]) {
  const ctx = ctxDe(eventos);
  const { container } = render(<>{montarTimeline(ctx).map((e) => e.node)}</>);
  return container;
}


describe('montarTimeline — raciocínio do agente (AT-676)', () => {
  it('mostra o bloco recolhido e abre com o texto inteiro e o total', () => {
    const container = montar([resposta({ content: 'ok', raciocinio: 'pensei muito', raciocinioTotal: 99 })]);
    const bloco = container.querySelector('[data-testid="raciocinio-do-turno"]');
    expect(bloco).toBeTruthy();
    expect(container.textContent).not.toContain('pensei muito');
    expect(bloco?.textContent).toContain('99');
    fireEvent.click(bloco!.querySelector('button')!);
    expect(container.textContent).toContain('pensei muito');
  });

  it('sem o campo, nada aparece', () => {
    const container = montar([resposta({ content: 'ok' })]);
    expect(container.querySelector('[data-testid="raciocinio-do-turno"]')).toBeNull();
  });

  it('não conta no corte do fio (RN-644)', () => {
    const com = montarTimeline(ctxDe([resposta({ content: 'ok', raciocinio: 'x' })]));
    const sem = montarTimeline(ctxDe([resposta({ content: 'ok' })]));
    expect(com.filter((e) => e.mensagem)).toHaveLength(sem.filter((e) => e.mensagem).length);
    expect(com.length).toBe(sem.length + 1);
  });
});

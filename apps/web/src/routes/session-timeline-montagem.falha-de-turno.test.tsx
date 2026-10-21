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

function falha(payload: Record<string, unknown>): SessionEvent {
  return {
    id: 'e1',
    seq: 1,
    type: 'agent.error',
    actor: { kind: 'agent', id: 'criativo' },
    payload,
    createdAt: '2026-09-30T12:00:00.000Z',
  } as SessionEvent;
}

function montar(eventos: SessionEvent[], extra: Record<string, unknown> = {}) {
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
  const { container } = render(<>{montarTimeline(ctx).map((e) => e.node)}</>);
  return container;
}

describe('montarTimeline — a bolha de falha de turno (AT-338)', () => {
  it('marca a bolha e a origem gravada pelo engine', () => {
    const container = montar([
      falha({ origem: 'politica', mensagem: 'Nenhuma credencial cadastrada para anthropic.' }),
    ]);
    const bolhas = container.querySelectorAll('[data-testid="falha-de-turno"]');
    expect(bolhas).toHaveLength(1);
    expect(bolhas[0]?.getAttribute('data-origem')).toBe('politica');
  });

  it('payload sem origem: a marca existe, e a origem NÃO é uma das quatro por chute', () => {
    const container = montar([falha({})]);
    const bolha = container.querySelector('[data-testid="falha-de-turno"]');
    expect(bolha).not.toBeNull();
    expect(['infra', 'modelo', 'codigo', 'politica']).not.toContain(
      bolha?.getAttribute('data-origem'),
    );
  });
});

describe('montarTimeline — o teto de iterações vira linha no fio (RN-698, AT-354)', () => {
  it('toolloop.limit_reached do PO aparece como falha de origem modelo, com o teto', () => {
    const container = montar([
      {
        ...falha({ iteration: 12, max_iterations: 12 }),
        type: 'toolloop.limit_reached',
        actor: { kind: 'agent', id: 'po' },
      } as SessionEvent,
    ]);
    const bolha = container.querySelector('[data-testid="falha-de-turno"]');
    expect(bolha?.getAttribute('data-origem')).toBe('modelo');
    expect(bolha?.textContent).toContain('o limite de um turno é 12');
  });

  it('AT-590: leva o gravado, as regras sem história e o botão que continua o MESMO agente', () => {
    const continuar = vi.fn();
    const container = montar(
      [
        {
          ...falha({
            max_iterations: 12,
            gravado: 'Gravado neste turno: 3 épicos.',
            regrasSemHistoria: 2,
          }),
          type: 'toolloop.limit_reached',
          actor: { kind: 'agent', id: 'po' },
        } as SessionEvent,
      ],
      { continuarRespostaCortada: continuar },
    );
    expect(container.querySelector('[data-testid="teto-gravado"]')?.textContent).toContain(
      '3 épicos',
    );
    expect(container.querySelector('[data-testid="teto-regras-sem-historia"]')?.textContent).toBe(
      '2 regras de negócio ainda estão sem história.',
    );
    fireEvent.click(container.querySelector('[data-testid="continuar-resposta-cortada"]')!);
    expect(continuar).toHaveBeenCalledWith('po');
  });

  it('AT-590 (falha): sem botão para dev-*, com a sessão inativa; sem extras, sem linhas', () => {
    const teto = (id: string) =>
      ({
        ...falha({ max_iterations: 12 }),
        type: 'toolloop.limit_reached',
        actor: { kind: 'agent', id },
      }) as SessionEvent;
    const continuar = vi.fn();
    const sel = '[data-testid="continuar-resposta-cortada"]';
    expect(
      montar([teto('dev-api')], { continuarRespostaCortada: continuar }).querySelector(sel),
    ).toBeNull();
    expect(
      montar([teto('po')], { continuarRespostaCortada: continuar, isActive: false }).querySelector(
        sel,
      ),
    ).toBeNull();
    const c = montar([teto('po')], { continuarRespostaCortada: continuar });
    expect(c.querySelector('[data-testid="teto-gravado"]')).toBeNull();
    expect(c.querySelector('[data-testid="teto-regras-sem-historia"]')).toBeNull();
  });

  it('AT-590: o agent.error limite_de_iteracoes do Criativo usa a mesma bolha, com botão', () => {
    const continuar = vi.fn();
    const container = montar(
      [
        falha({
          origem: 'modelo',
          reason: 'limite_de_iteracoes',
          max_iterations: 12,
          mensagem: 'frase-fixa-antiga',
          gravado: 'Gravado neste turno: 1 nota.',
        }),
      ],
      { continuarRespostaCortada: continuar },
    );
    expect(container.textContent).toContain('o limite de um turno é 12');
    expect(container.textContent).not.toContain('frase-fixa-antiga');
    fireEvent.click(container.querySelector('[data-testid="continuar-resposta-cortada"]')!);
    expect(continuar).toHaveBeenCalledWith('criativo');
  });

  it('sem o número no payload, a linha existe e não inventa um teto', () => {
    const container = montar([
      { ...falha({}), type: 'toolloop.limit_reached' } as SessionEvent,
    ]);
    const bolha = container.querySelector('[data-testid="falha-de-turno"]');
    expect(bolha?.textContent).toContain('o limite de um turno é ?');
  });
});

// RN-695 (AT-355): a análise da Anamnese não entra no fio da sessão.
describe('montarTimeline — a Anamnese fora do fio (AT-355)', () => {
  function resposta(ator: string, id: string, texto: string): SessionEvent {
    return {
      id,
      seq: Number(id.slice(1)),
      type: 'agent.response',
      actor: { kind: 'agent', id: ator },
      payload: { content: texto },
      createdAt: '2026-10-01T12:00:00.000Z',
    } as SessionEvent;
  }

  it('não desenha a resposta da Anamnese, e desenha a do Criativo', () => {
    const container = montar([
      resposta('criativo', 'e1', 'ideia do criativo'),
      resposta('anamnese', 'e2', 'Analisando a janela do log… usuário (09824667-aaaa)'),
    ]);
    expect(container.textContent).toContain('ideia do criativo');
    expect(container.textContent).not.toContain('09824667');
  });
});

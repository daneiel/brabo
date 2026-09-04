import { describe, expect, it } from 'vitest';
import * as moduloInteiro from './precisa-de-voce';
import {
  montarFilas,
  ORDEM_DAS_FILAS,
  temAlgoEsperando,
  type EntradaDasFilas,
} from './precisa-de-voce';
import type {
  ArchitecturePendency,
  Epic,
  ProposedAction,
  PsychologistHypothesis,
  Story,
} from './api-types';

function acao(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'acao-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'pnpm test' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:00:00.000Z',
    ...overrides,
  };
}

function historia(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'Checkout com um clique',
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    status: 'draft',
    proposedReady: false,
    returnedReason: null,
    returnedAt: null,
    createdAt: '2026-08-30T08:00:00.000Z',
    updatedAt: '2026-08-30T09:00:00.000Z',
    tasks: [],
    ...overrides,
  };
}

function epico(stories: Story[]): Epic {
  return {
    id: 'epic-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'Checkout',
    description: '',
    createdAt: '2026-08-30T08:00:00.000Z',
    updatedAt: '2026-08-30T08:00:00.000Z',
    stories,
  };
}

function hipotese(
  overrides: Partial<PsychologistHypothesis> = {},
): PsychologistHypothesis {
  return {
    id: 'hip-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    analysisId: 'an-1',
    agenteAlvo: 'dev-api',
    observacao: '',
    hipotese: 'O agente reescreve o teste em vez do código',
    sugestao: '',
    confiancaPercent: 70,
    evidenceEventIds: [],
    terminationAnalysis: null,
    status: 'proposed',
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-08-30T07:00:00.000Z',
    updatedAt: '2026-08-30T07:00:00.000Z',
    ...overrides,
  };
}

const PENDENCIA: ArchitecturePendency = {
  storyId: 'story-1',
  title: 'Checkout com um clique',
  status: 'draft',
  reason: 'missing_module',
  missing: ['pagamentos'],
};

const VAZIO: EntradaDasFilas = {
  acoesDaSessao: undefined,
  merges: undefined,
  epicos: undefined,
  pendenciasDeArquitetura: undefined,
  hipoteses: undefined,
};

function filaDe(filas: ReturnType<typeof montarFilas>, chave: string) {
  return filas.find((f) => f.chave === chave)!;
}

describe('montarFilas — as cinco filas continuam CINCO', () => {
  it('devolve as cinco filas, sempre na mesma ordem de urgência', () => {
    const filas = montarFilas(VAZIO);
    expect(filas.map((f) => f.chave)).toEqual([...ORDEM_DAS_FILAS]);
    expect(filas).toHaveLength(5);
  });

  it('cada fila carrega os SEUS itens — nada é somado numa lista só', () => {
    const filas = montarFilas({
      acoesDaSessao: [acao({ id: 'a1' }), acao({ id: 'a2' })],
      merges: [acao({ id: 'm1', actionType: 'git_merge' })],
      epicos: [
        epico([
          historia({ id: 's1', proposedReady: true }),
          historia({ id: 's2', proposedReady: true }),
          historia({ id: 's3', proposedReady: true }),
        ]),
      ],
      pendenciasDeArquitetura: [PENDENCIA],
      hipoteses: [hipotese({ id: 'h1' }), hipotese({ id: 'h2' })],
    });

    expect(filaDe(filas, 'aprovacoes').itens).toHaveLength(2);
    expect(filaDe(filas, 'prs').itens).toHaveLength(1);
    expect(filaDe(filas, 'promocoes').itens).toHaveLength(3);
    expect(filaDe(filas, 'arquitetura').itens).toHaveLength(1);
    expect(filaDe(filas, 'hipoteses').itens).toHaveLength(2);

    // O total do projeto NÃO existe: nenhuma fila carrega a soma das outras,
    // e o módulo não exporta função que a produza. Somar apagaria QUAL fila
    // pede atenção — a mesma decisão dos contadores do trilho (ADR 0126).
    expect(Object.keys(moduloInteiro)).not.toContain('totalDeFilas');
    expect(filas.reduce((n, f) => n + f.itens.length, 0)).toBe(9);
    expect(filas.some((f) => f.itens.length === 9)).toBe(false);
  });

  it('só conta o que está mesmo esperando: ação decidida e hipótese aceita saem', () => {
    const filas = montarFilas({
      ...VAZIO,
      acoesDaSessao: [
        acao({ id: 'a1' }),
        acao({ id: 'a2', status: 'approved' }),
        acao({ id: 'a3', status: 'denied' }),
      ],
      hipoteses: [
        hipotese({ id: 'h1' }),
        hipotese({ id: 'h2', status: 'accepted' }),
        hipotese({ id: 'h3', status: 'dismissed' }),
      ],
      epicos: [epico([historia({ id: 's1' }), historia({ id: 's2', proposedReady: true })])],
    });

    expect(filaDe(filas, 'aprovacoes').itens.map((i) => i.id)).toEqual(['a1']);
    expect(filaDe(filas, 'hipoteses').itens.map((i) => i.id)).toEqual(['hipotese:h1']);
    expect(filaDe(filas, 'promocoes').itens.map((i) => i.id)).toEqual(['promocao:s2']);
  });

  it('o MESMO git_merge que chega pelos dois hooks aparece UMA vez, na fila de PRs', () => {
    const merge = acao({ id: 'merge-1', actionType: 'git_merge' });
    const filas = montarFilas({
      ...VAZIO,
      // `usePendingActions` é da sessão e não filtra por tipo; o merge cai nos
      // dois. Numa lista só, isso seria a mesma decisão contada duas vezes.
      acoesDaSessao: [merge, acao({ id: 'outra' })],
      merges: [merge],
    });

    expect(filaDe(filas, 'aprovacoes').itens.map((i) => i.id)).toEqual(['outra']);
    expect(filaDe(filas, 'prs').itens.map((i) => i.id)).toEqual(['merge-1']);
  });

  it('dentro da fila, quem espera há mais tempo vem primeiro', () => {
    const filas = montarFilas({
      ...VAZIO,
      acoesDaSessao: [
        acao({ id: 'nova', createdAt: '2026-08-30T12:00:00.000Z' }),
        acao({ id: 'velha', createdAt: '2026-08-29T12:00:00.000Z' }),
        acao({ id: 'media', createdAt: '2026-08-30T06:00:00.000Z' }),
      ],
    });

    expect(filaDe(filas, 'aprovacoes').itens.map((i) => i.id)).toEqual([
      'velha',
      'media',
      'nova',
    ]);
  });
});

describe('montarFilas — a pendência de arquitetura não tem data própria', () => {
  it('empresta a data da história relacionada e MARCA que emprestou', () => {
    const filas = montarFilas({
      ...VAZIO,
      epicos: [epico([historia({ id: 'story-1', updatedAt: '2026-08-30T09:30:00.000Z' })])],
      pendenciasDeArquitetura: [PENDENCIA],
    });

    const item = filaDe(filas, 'arquitetura').itens[0]!;
    expect(item.desde).toBe('2026-08-30T09:30:00.000Z');
    expect(item.dataEmprestada).toBe(true);
    expect(item.aba).toBe('arquitetura');
  });

  it('sem a história carregada NÃO inventa data: `desde` é null e o item vai para o fim', () => {
    const filas = montarFilas({
      ...VAZIO,
      // O backlog não trouxe `story-1` — emprestar de um registro que não se
      // tem seria a mesma invenção que renderizar "agora".
      epicos: [epico([])],
      pendenciasDeArquitetura: [
        PENDENCIA,
        { ...PENDENCIA, storyId: 'story-9', title: 'Outra' },
      ],
    });

    const itens = filaDe(filas, 'arquitetura').itens;
    expect(itens).toHaveLength(2);
    expect(itens.every((i) => i.desde === null)).toBe(true);
    expect(itens.every((i) => i.dataEmprestada !== true)).toBe(true);
  });

  it('item sem data vai para o FIM da fila, nunca para a frente', () => {
    const filas = montarFilas({
      ...VAZIO,
      epicos: [epico([historia({ id: 'story-1', updatedAt: '2026-08-30T09:30:00.000Z' })])],
      pendenciasDeArquitetura: [
        { ...PENDENCIA, storyId: 'story-orfa', title: 'Órfã' },
        PENDENCIA,
      ],
    });

    expect(filaDe(filas, 'arquitetura').itens.map((i) => i.titulo)).toEqual([
      'Checkout com um clique',
      'Órfã',
    ]);
  });
});

describe('temAlgoEsperando', () => {
  it('é falso com as cinco filas vazias', () => {
    expect(temAlgoEsperando(montarFilas(VAZIO))).toBe(false);
  });

  it('basta UMA fila com item — e a resposta é booleana, nunca um total', () => {
    const filas = montarFilas({ ...VAZIO, hipoteses: [hipotese()] });
    expect(temAlgoEsperando(filas)).toBe(true);
  });
});

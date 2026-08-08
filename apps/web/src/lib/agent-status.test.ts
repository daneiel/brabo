import { describe, it, expect } from 'vitest';
import {
  breakerReasonFor,
  deriveAgentRoster,
  groupRosterByArea,
  rosterFactsFromEvents,
  rosterFromFacts,
  type RosterEntry,
} from './agent-status';
import { AGENTS } from './agents';
import type { Handoff, ModuleMap, SessionEvent } from './api-types';

let seq = 0;
function ev(
  type: string,
  actorId: string,
  payload: Record<string, unknown> = {},
): SessionEvent {
  seq += 1;
  return {
    id: `e-${seq}`,
    sessionId: 'sess-1',
    seq,
    type,
    actor: { kind: 'agent', id: actorId },
    payload,
    createdAt: new Date().toISOString(),
  };
}

const moduleMap: ModuleMap = {
  modules: [
    { name: 'core', stack: 'Node.js', responsibility: 'cálculo', dependsOn: [] },
  ],
} as unknown as ModuleMap;

const handoffInfra: Handoff = {
  id: 'h-1',
  sessionId: 'sess-1',
  projectId: 'proj-1',
  fromAgent: 'arquiteto',
  toAgent: 'infra',
  artifactId: null,
  status: 'accepted',
} as unknown as Handoff;

function statusOf(roster: ReturnType<typeof deriveAgentRoster>, id: string) {
  return roster.find((r) => r.id === id)?.status;
}

describe('deriveAgentRoster — composição', () => {
  it('sem execução ativada: só os três conversacionais', () => {
    const roster = deriveAgentRoster([], null, false, []);
    expect(roster.map((r) => r.id)).toEqual(['criativo', 'po', 'arquiteto']);
  });

  it('execução ativada com module_map: um dev por módulo', () => {
    const roster = deriveAgentRoster([], moduleMap, true, []);
    expect(roster.map((r) => r.id)).toContain('dev-core');
  });

  it('qa/secops só entram depois que algum gate abriu', () => {
    const semGate = deriveAgentRoster([], moduleMap, true, []);
    expect(semGate.map((r) => r.id)).not.toContain('qa');

    const comGate = deriveAgentRoster(
      [ev('pr.gate_changed', 'qa-agent', { gateStatus: 'awaiting_qa' })],
      moduleMap,
      true,
      [],
    );
    expect(comGate.map((r) => r.id)).toEqual(
      expect.arrayContaining(['qa', 'secops']),
    );
  });

  it('gate de INFRA também instancia qa/secops no painel', () => {
    const roster = deriveAgentRoster(
      [ev('infra.gate_changed', 'infra-gate', { gateStatus: 'awaiting_secops' })],
      null,
      false,
      [],
    );
    expect(roster.map((r) => r.id)).toEqual(
      expect.arrayContaining(['qa', 'secops']),
    );
    expect(statusOf(roster, 'secops')).toBe('trabalhando');
    expect(statusOf(roster, 'qa')).toBe('ocioso');
  });

  it('infra só entra com handoff aceito', () => {
    expect(deriveAgentRoster([], null, false, []).map((r) => r.id)).not.toContain(
      'infra',
    );
    expect(
      deriveAgentRoster([], null, false, [handoffInfra]).map((r) => r.id),
    ).toContain('infra');
  });
});

describe('deriveAgentRoster — status', () => {
  it('conversacional segue o último agent.status persistido', () => {
    // Regressão do ADR 0021: `agent.status` só era broadcastado, nunca
    // persistido, então estes quatro agentes ficavam presos em "ocioso".
    const roster = deriveAgentRoster(
      [
        ev('agent.status', 'criativo', { status: 'idle' }),
        ev('agent.status', 'criativo', { status: 'working' }),
      ],
      null,
      false,
      [],
    );
    expect(statusOf(roster, 'criativo')).toBe('trabalhando');
    expect(statusOf(roster, 'po')).toBe('ocioso');
  });

  it('dev sem evento nenhum é ocioso, não trabalhando', () => {
    const roster = deriveAgentRoster([], moduleMap, true, []);
    expect(statusOf(roster, 'dev-core')).toBe('ocioso');
  });

  it('dev.idle deixa o dev ocioso', () => {
    const roster = deriveAgentRoster(
      [
        ev('dev.working', 'dev-core', {}),
        ev('dev.idle', 'dev-core', { reason: 'sem task pegável' }),
      ],
      moduleMap,
      true,
      [],
    );
    expect(statusOf(roster, 'dev-core')).toBe('ocioso');
  });

  it('task bloqueada deixa o dev em falhou', () => {
    const roster = deriveAgentRoster(
      [ev('backlog.task_blocked', 'dev-core', {})],
      moduleMap,
      true,
      [],
    );
    expect(statusOf(roster, 'dev-core')).toBe('falhou');
  });

  it('ação pendente de aprovação deixa o agente aguardando', () => {
    // `aguardando` era inalcançável antes do ADR 0021 — o contador do header
    // ficava sempre em 0.
    const roster = deriveAgentRoster(
      [ev('dev.working', 'dev-core', {})],
      moduleMap,
      true,
      [],
      new Set(['dev-core']),
    );
    expect(statusOf(roster, 'dev-core')).toBe('aguardando');
  });

  it('falhou vence aguardando — o bloqueio é o que o usuário precisa ver', () => {
    const roster = deriveAgentRoster(
      [ev('backlog.task_blocked', 'dev-core', {})],
      moduleMap,
      true,
      [],
      new Set(['dev-core']),
    );
    expect(statusOf(roster, 'dev-core')).toBe('falhou');
  });

  describe('Fase 12b — RN-047', () => {
    it('dev.awaiting_gate deixa o dev aguardando (PR aberta, esperando o gate)', () => {
      const roster = deriveAgentRoster(
        [
          ev('dev.working', 'dev-core', {}),
          ev('dev.awaiting_gate', 'dev-core', { taskId: 't1', gate: 'qa' }),
        ],
        moduleMap,
        true,
        [],
      );
      expect(statusOf(roster, 'dev-core')).toBe('aguardando');
    });

    it('dev.idle_tripped deixa o dev travado', () => {
      const roster = deriveAgentRoster(
        [ev('dev.idle_tripped', 'dev-core', { consecutiveBlocked: 3 })],
        moduleMap,
        true,
        [],
      );
      expect(statusOf(roster, 'dev-core')).toBe('travado');
    });

    it('travado vence aguardando — o breaker parou o agente de propósito', () => {
      const roster = deriveAgentRoster(
        [ev('dev.idle_tripped', 'dev-core', { consecutiveBlocked: 3 })],
        moduleMap,
        true,
        [],
        new Set(['dev-core']),
      );
      expect(statusOf(roster, 'dev-core')).toBe('travado');
    });

    it('breakerReasonFor extrai o contador do dev.idle_tripped mais recente', () => {
      expect(
        breakerReasonFor(
          [ev('dev.idle_tripped', 'dev-core', { consecutiveBlocked: 3 })],
          'dev-core',
        ),
      ).toBe('circuit breaker: 3 tasks blocked seguidas');

      expect(breakerReasonFor([], 'dev-core')).toBeUndefined();
    });

    it('dev.idle depois de dev.working limpa o card — não fica preso em ocioso mostrando a task antiga', () => {
      // A prova em si é de execution.ts (deriveExecutionProgress); aqui
      // só confirma que o STATUS reflete o evento mais recente.
      const roster = deriveAgentRoster(
        [
          ev('dev.working', 'dev-core', { taskId: 't1', taskTitle: 'Implementar x' }),
          ev('dev.idle', 'dev-core', { reason: 'sem task pegável' }),
        ],
        moduleMap,
        true,
        [],
      );
      expect(statusOf(roster, 'dev-core')).toBe('ocioso');
    });
  });
});

describe('deriveAgentRoster — subagentes de área (Fase 8b/8c, no painel — Fase 8d)', () => {
  const gateEvent = ev('pr.gate_changed', 'qa-agent', { gateStatus: 'awaiting_qa' });

  it('subagente só entra na roster com pelo menos uma delegação registrada', () => {
    const semDelegacao = deriveAgentRoster([gateEvent], moduleMap, true, []);
    expect(semDelegacao.map((r) => r.id)).not.toContain('qa-automacao');

    const comDelegacao = deriveAgentRoster(
      [gateEvent, ev('delegation.completed', 'qa-lead', { subagent: 'qa-automacao', area: 'qa' })],
      moduleMap,
      true,
      [],
    );
    expect(comDelegacao.map((r) => r.id)).toContain('qa-automacao');
  });

  it('só o subagente delegado aparece — a outra subespecialidade fica de fora', () => {
    const roster = deriveAgentRoster(
      [gateEvent, ev('delegation.completed', 'qa-lead', { subagent: 'qa-automacao', area: 'qa' })],
      moduleMap,
      true,
      [],
    );
    expect(roster.map((r) => r.id)).not.toContain('qa-performance-seguranca');
  });

  it('delegação dispensada também conta como evidência — dispensa é decisão, não silêncio', () => {
    const roster = deriveAgentRoster(
      [
        gateEvent,
        ev('delegation.dispensed', 'qa-lead', {
          subagent: 'qa-performance-seguranca',
          area: 'qa',
          justification: 'sem RNF de performance',
        }),
      ],
      moduleMap,
      true,
      [],
    );
    expect(roster.map((r) => r.id)).toContain('qa-performance-seguranca');
    expect(statusOf(roster, 'qa-performance-seguranca')).toBe('ocioso');
  });

  it('delegation.failed mais recente deixa o subagente em falhou', () => {
    const roster = deriveAgentRoster(
      [
        gateEvent,
        ev('delegation.completed', 'qa-lead', { subagent: 'qa-automacao', area: 'qa' }),
        ev('delegation.failed', 'qa-lead', {
          subagent: 'qa-automacao',
          area: 'qa',
          failureOrigin: 'modelo',
        }),
      ],
      moduleMap,
      true,
      [],
    );
    expect(statusOf(roster, 'qa-automacao')).toBe('falhou');
  });

  it('infra-workflows entra sob o mesmo critério, associado à área infra', () => {
    const roster = deriveAgentRoster(
      [ev('delegation.completed', 'infra-lead', { subagent: 'infra-workflows', area: 'infra' })],
      null,
      false,
      [handoffInfra],
    );
    expect(roster.map((r) => r.id)).toEqual(
      expect.arrayContaining(['infra', 'infra-workflows']),
    );
  });
});

describe('groupRosterByArea', () => {
  function entry(id: keyof typeof AGENTS): RosterEntry {
    return { id, def: AGENTS[id], status: 'ocioso' };
  }

  it('lead de QA com as duas subespecialidades vira UM grupo de área', () => {
    const roster = [
      entry('qa'),
      entry('qa-automacao'),
      entry('qa-performance-seguranca'),
    ];

    const groups = groupRosterByArea(roster);

    expect(groups).toEqual([
      {
        kind: 'area',
        areaKey: 'qa',
        lead: roster[0],
        members: [roster[1], roster[2]],
      },
    ]);
  });

  it('lead de QA com só uma subespecialidade delegada — grupo com 1 membro', () => {
    const roster = [entry('qa'), entry('qa-automacao')];

    const groups = groupRosterByArea(roster);

    expect(groups).toEqual([
      { kind: 'area', areaKey: 'qa', lead: roster[0], members: [roster[1]] },
    ]);
  });

  it('agentes sem área (po/criativo/arquiteto) ficam soltos, na ordem da roster', () => {
    const roster = [entry('criativo'), entry('po'), entry('arquiteto')];

    const groups = groupRosterByArea(roster);

    expect(groups).toEqual([
      { kind: 'solo', entry: roster[0] },
      { kind: 'solo', entry: roster[1] },
      { kind: 'solo', entry: roster[2] },
    ]);
  });

  it('mistura: solo + área, sem duplicar o membro como solo também', () => {
    const roster = [entry('po'), entry('qa'), entry('qa-automacao')];

    const groups = groupRosterByArea(roster);

    expect(groups).toEqual([
      { kind: 'solo', entry: roster[0] },
      { kind: 'area', areaKey: 'qa', lead: roster[1], members: [roster[2]] },
    ]);
  });

  it('roster vazia devolve lista vazia', () => {
    expect(groupRosterByArea([])).toEqual([]);
  });
});

/**
 * A regra de PRESENÇA é uma só (RN-090).
 *
 * O card do dashboard monta os chips a partir dos fatos que a api devolve, e
 * o painel do time monta a roster a partir do event log. São dois caminhos —
 * mas têm de passar pela MESMA regra, senão o primeiro agente novo aparece
 * num e não no outro. Estes testes fixam a equivalência.
 */
describe('rosterFromFacts — a mesma regra nos dois caminhos', () => {
  const eventos = [
    ev('execution.activated', 'sistema'),
    ev('pr.gate_changed', 'qa', { gateStatus: 'awaiting_qa' }),
    ev('delegation.completed', 'qa', { subagent: 'qa-automacao' }),
  ];

  it('os fatos extraídos do event log reproduzem a roster do painel', () => {
    const doPainel = deriveAgentRoster(eventos, moduleMap, true, [handoffInfra]);

    const fatos = rosterFactsFromEvents(eventos, moduleMap, true, [handoffInfra]);
    const doCard = rosterFromFacts(fatos, () => 'ocioso');

    // Mesmos agentes, na mesma ordem — o que muda é só o status, que o card
    // não desenha.
    expect(doCard.map((r) => r.id)).toEqual(doPainel.map((r) => r.id));
  });

  it('os fatos que a api devolve produzem os mesmos chips', () => {
    const doPainel = deriveAgentRoster(eventos, moduleMap, true, [handoffInfra]);

    // Exatamente o formato de `roster` em `ProjectCardSummary`.
    const daApi = rosterFromFacts(
      {
        executionActivated: true,
        moduleNames: ['core'],
        gatesEverOpened: true,
        delegatedSubagents: ['qa-automacao'],
        infraActive: true,
      },
      () => 'ocioso',
    );

    expect(daApi.map((r) => r.id)).toEqual(doPainel.map((r) => r.id));
    expect(groupRosterByArea(daApi).map((g) => g.kind)).toEqual(
      groupRosterByArea(doPainel).map((g) => g.kind),
    );
  });

  it('sem fato nenhum: só os três conversacionais, como no painel', () => {
    const daApi = rosterFromFacts(
      {
        executionActivated: false,
        moduleNames: [],
        gatesEverOpened: false,
        delegatedSubagents: [],
        infraActive: false,
      },
      () => 'ocioso',
    );

    expect(daApi.map((r) => r.id)).toEqual(['criativo', 'po', 'arquiteto']);
    expect(daApi.map((r) => r.id)).toEqual(
      deriveAgentRoster([], null, false, []).map((r) => r.id),
    );
  });
});

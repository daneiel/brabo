import { describe, it, expect } from 'vitest';
import { deriveAgentRoster } from './agent-status';
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
});

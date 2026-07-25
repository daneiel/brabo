import { describe, it, expect } from 'vitest';
import { deriveExecutionProgress, formatMicros } from './execution';
import type { SessionEvent } from './api-types';

let seq = 0;
function ev(
  type: string,
  actorId: string,
  payload: Record<string, unknown>,
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

describe('deriveExecutionProgress', () => {
  it('monta módulo, branch, task e título a partir de dev.started/dev.working', () => {
    const agents = deriveExecutionProgress([
      ev('dev.started', 'dev-api', { agentId: 'dev-api', module: 'api' }),
      ev('dev.working', 'dev-api', {
        agentId: 'dev-api',
        taskId: 't-1',
        taskTitle: 'Endpoint de cadastro',
        branch: 'feature/task-abc',
      }),
    ]);

    expect(agents.get('dev-api')).toEqual({
      module: 'api',
      branch: 'feature/task-abc',
      taskId: 't-1',
      taskTitle: 'Endpoint de cadastro',
    });
  });

  it('o título da task é o que o painel mostra — sem ele só sobra a branch opaca', () => {
    const agents = deriveExecutionProgress([
      ev('dev.started', 'dev-api', { agentId: 'dev-api', module: 'api' }),
      ev('dev.working', 'dev-api', {
        agentId: 'dev-api',
        taskId: '9f1c2d3e-aaaa-4bbb-8ccc-dddddddddddd',
        taskTitle: 'Validação de e-mail',
        branch: 'feature/task-9f1c2d3e',
      }),
    ]);

    expect(agents.get('dev-api')?.taskTitle).toBe('Validação de e-mail');
  });

  it('iteração e custo vêm do ÚLTIMO agent.response do agente', () => {
    const agents = deriveExecutionProgress([
      ev('dev.started', 'dev-api', { agentId: 'dev-api', module: 'api' }),
      ev('agent.response', 'dev-api', { iteration: 1, tokensSpentMicros: 1200 }),
      ev('agent.response', 'dev-api', { iteration: 4, tokensSpentMicros: 9800 }),
    ]);

    expect(agents.get('dev-api')?.iteration).toBe(4);
    expect(agents.get('dev-api')?.tokensSpentMicros).toBe(9800);
  });

  it('ignora agent.response de agente que não é dev (criativo/po/arquiteto)', () => {
    const agents = deriveExecutionProgress([
      ev('agent.response', 'criativo', { iteration: 3, tokensSpentMicros: 500 }),
    ]);

    expect(agents.has('criativo')).toBe(false);
  });

  it('a task mais recente sobrescreve a anterior do mesmo agente', () => {
    const agents = deriveExecutionProgress([
      ev('dev.started', 'dev-api', { agentId: 'dev-api', module: 'api' }),
      ev('dev.working', 'dev-api', {
        agentId: 'dev-api',
        taskId: 't-1',
        taskTitle: 'Primeira',
        branch: 'feature/task-1',
      }),
      ev('dev.working', 'dev-api', {
        agentId: 'dev-api',
        taskId: 't-2',
        taskTitle: 'Segunda',
        branch: 'feature/task-2',
      }),
    ]);

    expect(agents.get('dev-api')?.taskTitle).toBe('Segunda');
    expect(agents.get('dev-api')?.branch).toBe('feature/task-2');
  });

  it('vários agentes em paralelo não se misturam', () => {
    const agents = deriveExecutionProgress([
      ev('dev.started', 'dev-api', { agentId: 'dev-api', module: 'api' }),
      ev('dev.started', 'dev-web', { agentId: 'dev-web', module: 'web' }),
      ev('dev.started', 'dev-api-2', { agentId: 'dev-api-2', module: 'api' }),
      ev('dev.working', 'dev-api', {
        agentId: 'dev-api',
        taskId: 't-1',
        taskTitle: 'A',
        branch: 'feature/task-1',
      }),
      ev('dev.working', 'dev-web', {
        agentId: 'dev-web',
        taskId: 't-2',
        taskTitle: 'B',
        branch: 'feature/task-2',
      }),
      ev('agent.response', 'dev-api', { iteration: 2, tokensSpentMicros: 100 }),
    ]);

    expect(agents.size).toBe(3);
    expect(agents.get('dev-api')?.taskTitle).toBe('A');
    expect(agents.get('dev-web')?.taskTitle).toBe('B');
    expect(agents.get('dev-web')?.iteration).toBeUndefined();
    expect(agents.get('dev-api-2')?.module).toBe('api');
  });

  it('dev.working sem dev.started prévio ainda registra o agente', () => {
    // Rehydration: o agente volta vivo sem reemitir dev.started.
    const agents = deriveExecutionProgress([
      ev('dev.working', 'dev-api', {
        agentId: 'dev-api',
        taskId: 't-1',
        taskTitle: 'A',
        branch: 'feature/task-1',
      }),
    ]);

    expect(agents.get('dev-api')?.module).toBe('');
    expect(agents.get('dev-api')?.taskTitle).toBe('A');
  });

  it('event log vazio devolve mapa vazio', () => {
    expect(deriveExecutionProgress([]).size).toBe(0);
  });
});

describe('formatMicros', () => {
  it('formata micro-USD em US$ com 4 casas', () => {
    expect(formatMicros(0)).toBe('US$ 0.0000');
    expect(formatMicros(1_000_000)).toBe('US$ 1.0000');
    expect(formatMicros(12_345)).toBe('US$ 0.0123');
  });
});

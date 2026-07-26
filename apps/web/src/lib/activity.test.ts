import { describe, it, expect } from 'vitest';
import { classifyEvent } from './activity';
import type { SessionEvent } from './api-types';

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

describe('classifyEvent — fase de execução (Fase 4a)', () => {
  it('claim de task nomeia a task, não "atualizou o backlog"', () => {
    const c = classifyEvent(
      ev('backlog.task_claimed', 'dev-core', {
        title: 'Implementar soma(a, b)',
        module: 'core',
      }),
    );
    expect(c.text).toContain('Implementar soma(a, b)');
    expect(c.text).toContain('core');
    expect(c.text).not.toContain('atualizou o backlog');
  });

  it('PR de dev é narrada como PR, não como "executou um comando"', () => {
    // A api grava `action.pr_open`; antes isso caía no ramo genérico de
    // `action.*` e virava terminal.
    const c = classifyEvent(
      ev('action.pr_open', 'git-executor', { sourceBranch: 'feature/task-abc' }),
    );
    expect(c.kind).toBe('pr');
    expect(c.text).toContain('feature/task-abc');
  });

  it('commit e push de agente aparecem como commit', () => {
    expect(classifyEvent(ev('action.git_commit', 'dev-core', { branch: 'f/x' })).kind).toBe(
      'commit',
    );
    expect(classifyEvent(ev('action.git_push', 'dev-core', {})).kind).toBe('commit');
  });

  it('task bloqueada mostra o motivo e marca como ruim', () => {
    const c = classifyEvent(
      ev('backlog.task_blocked', 'dev-core', { reason: 'limite de iterações' }),
    );
    expect(c.bad).toBe(true);
    expect(c.text).toContain('limite de iterações');
  });

  it('task desbloqueada e mudança de status têm texto próprio', () => {
    expect(classifyEvent(ev('backlog.task_unblocked', 'user', {})).text).toContain(
      'desbloqueada',
    );
    expect(
      classifyEvent(ev('backlog.task_status_changed', 'dev-core', { status: 'in_review' }))
        .text,
    ).toContain('in_review');
  });

  it('parecer de gate distingue dev de infra pelo prActionId', () => {
    const dev = classifyEvent(ev('artifact.qa_verdict', 'qa', { taskId: 't-1' }));
    const infra = classifyEvent(
      ev('artifact.qa_verdict', 'infra-gate', { prActionId: 'a-1' }),
    );
    expect(dev.text).not.toEqual(infra.text);
  });

  it('sugestão de paralelização é narrada', () => {
    const c = classifyEvent(
      ev('execution.parallelization_suggested', 'parallelization', { module: 'core' }),
    );
    expect(c.text).toContain('core');
  });

  it('tipo desconhecido cai no genérico sem quebrar', () => {
    const c = classifyEvent(ev('xpto.aconteceu', 'alguem', {}));
    expect(c.kind).toBe('generic');
    expect(c.text).toContain('xpto.aconteceu');
  });
});

describe('classifyEvent — Psicólogo (Fase 4b)', () => {
  it('hipótese proposta nomeia o agente alvo', () => {
    const c = classifyEvent(
      ev('psychologist.hypothesis_proposed', 'psicologo', {
        agenteAlvo: 'dev-api',
      }),
    );

    expect(c.kind).toBe('hypothesis');
    expect(c.text).toContain('dev-api');
    expect(c.bad).toBe(false);
  });

  it('aceite e descarte se distinguem no texto', () => {
    expect(
      classifyEvent(
        ev('psychologist.hypothesis_accepted', 'user', { agenteAlvo: 'qa' }),
      ).text,
    ).toContain('aceita');

    expect(
      classifyEvent(
        ev('psychologist.hypothesis_dismissed', 'user', { agenteAlvo: 'qa' }),
      ).text,
    ).toContain('descartada');
  });

  it('encaminhamento pra Anamnese é narrado como tal', () => {
    expect(
      classifyEvent(
        ev('psychologist.hypothesis_accepted_for_anamnese', 'user', {}),
      ).text,
    ).toContain('Anamnese');
  });

  it('análise concluída informa a triagem usada', () => {
    expect(
      classifyEvent(
        ev('psychologist.analysis_completed', 'psicologo-leve', {
          tier: 'leve',
        }),
      ).text,
    ).toContain('leve');
  });

  it('análise falha é marcada como ruim e carrega o motivo', () => {
    const c = classifyEvent(
      ev('psychologist.analysis_failed', 'psicologo', {
        reason: 'orçamento excedido',
      }),
    );

    expect(c.bad).toBe(true);
    expect(c.text).toContain('orçamento excedido');
  });

  it('tipo psychologist.* desconhecido não quebra a narração', () => {
    const c = classifyEvent(ev('psychologist.algo_novo', 'psicologo', {}));

    expect(c.kind).toBe('hypothesis');
    expect(c.text).toContain('psychologist.algo_novo');
  });
});

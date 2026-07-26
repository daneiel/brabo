/*
 * Previews do EventItem — a linha de um evento do event log.
 *
 * O ícone, a cor e o texto NÃO vêm por prop: saem de classifyEvent(event) em
 * apps/web/src/lib/activity.ts, que lê `type` e `payload`. Então o que faz um
 * preview honesto aqui é variar o TIPO do evento, não estilizar a linha.
 *
 * O horário passa por formatRelativeTime, que compara com Date.now() — os
 * offsets abaixo partem de agora para o rótulo não derivar com o tempo.
 */
import { EventItem } from 'web';

type Evento = Parameters<typeof EventItem>[0]['event'];

let seq = 0;
function evento(
  minutosAtras: number,
  type: string,
  ator: string,
  payload: Record<string, unknown> = {},
): Evento {
  seq += 1;
  return {
    id: `evt-${seq}`,
    sessionId: 'session-1',
    seq,
    type,
    actor: ator === 'user' ? { kind: 'user', id: 'user-1' } : { kind: 'agent', id: ator },
    payload,
    createdAt: new Date(Date.now() - minutosAtras * 60_000).toISOString(),
  } as Evento;
}

const pilha: React.CSSProperties = { display: 'grid' };

/** Os tipos narrativos mais comuns, cada um com seu ícone e sua cor. */
export function TiposNarrativos() {
  return (
    <div style={pilha}>
      <EventItem event={evento(41, 'agent.activated', 'dev-backend')} />
      <EventItem
        event={evento(33, 'backlog.task_claimed', 'dev-backend', {
          title: 'drenar sessões ativas no preStop',
          module: 'engine',
        })}
      />
      <EventItem
        event={evento(24, 'action.git_commit', 'dev-backend', { branch: 'feature/dev-backend/drain' })}
      />
      <EventItem
        event={evento(18, 'action.pr_open', 'dev-backend', { sourceBranch: 'feature/dev-backend/drain' })}
      />
      <EventItem event={evento(7, 'permission.granted', 'user', { pattern: 'git push origin feature/*' })} />
    </div>
  );
}

/** Eventos ruins: classifyEvent marca `bad` e a linha vira danger. */
export function EventosRuins() {
  return (
    <div style={pilha}>
      <EventItem
        event={evento(29, 'artifact.qa_verdict', 'qa', { veredito: 'changes_requested', taskId: 'task-9' })}
      />
      <EventItem
        event={evento(22, 'backlog.task_blocked', 'dev-backend', {
          reason: 'ciclo de correção do gate esgotado',
        })}
      />
      <EventItem
        event={evento(15, 'instruction.patch_failed', 'anamnese', {
          reason: 'versão de origem não é mais a atual',
        })}
      />
      <EventItem event={evento(4, 'session.closed_abnormally', 'infra')} />
    </div>
  );
}

/** `highlighted` é o alvo da navegação de evidência do Psicólogo. */
export function Destacado() {
  return (
    <div style={pilha}>
      <EventItem event={evento(12, 'agent.response', 'dev-backend')} highlighted />
      <EventItem event={evento(9, 'tool.result', 'dev-backend', { tool: 'run_tests' })} />
    </div>
  );
}

/** Tipo desconhecido cai no fallback genérico — ator · tipo, sem inventar. */
export function TipoDesconhecido() {
  return <EventItem event={evento(2, 'algo.que.o.backend.inventou', 'infra')} />;
}

/*
 * Previews do NotificationBell.
 *
 * O valor do componente é o PAINEL agrupado por projeto, e ele vive em estado
 * interno (`open`), sem prop que o abra: um preview que só monta o componente
 * mostra um sininho e nada mais — três células praticamente idênticas, com a
 * prop `groups` sem efeito visível nenhum.
 *
 * Por isso o `Aberto` clica no próprio trigger depois do mount. É a única forma
 * de o card mostrar o que a composição realmente é, e continua determinístico:
 * o clique é síncrono no effect, não uma animação com tempo.
 *
 * Os horários passam por formatRelativeTime (compara com Date.now()), então os
 * offsets partem de agora — data fixa faria o rótulo derivar com o tempo.
 */
import { useEffect, useRef } from 'react';
import { NotificationBell } from 'web';

type Grupos = Parameters<typeof NotificationBell>[0]['groups'];

let seq = 0;
function evento(minutosAtras: number, type: string, ator: string, payload: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `evt-${seq}`,
    sessionId: 'session-1',
    seq,
    type,
    actor: { kind: 'agent' as const, id: ator },
    payload,
    createdAt: new Date(Date.now() - minutosAtras * 60_000).toISOString(),
  };
}

function Aberto({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[aria-label="Notificações"]')?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

const umProjeto = [
  {
    projectId: 'p1',
    projectName: 'plataforma-de-pagamentos',
    events: [
      evento(3, 'artifact.qa_verdict', 'qa', { veredito: 'changes_requested', taskId: 'task-9' }),
      evento(9, 'action.pr_open', 'dev-backend', { sourceBranch: 'feature/dev-backend/oban-metrics' }),
      evento(21, 'psychologist.hypothesis_proposed', 'psicologo', { agenteAlvo: 'dev-backend' }),
    ],
  },
] as Grupos;

const variosProjetos = [
  ...umProjeto,
  {
    projectId: 'p2',
    projectName: 'portal-do-cliente',
    events: [
      evento(6, 'backlog.task_blocked', 'dev-frontend', { reason: 'dependência do módulo de auth' }),
      evento(11, 'action.git_commit', 'dev-frontend', { branch: 'feature/dev-frontend/checkout' }),
    ],
  },
  {
    projectId: 'p3',
    projectName: 'brabo-interno',
    events: [evento(44, 'infra.pr_opened', 'infra', { title: 'chart do Grafana provisionado' })],
  },
] as Grupos;

const noop = () => {};

/** O painel aberto num projeto — o que o sino existe para mostrar. */
export function PainelAberto() {
  return (
    <Aberto>
      <NotificationBell groups={umProjeto} unreadCount={3} onMarkRead={noop} />
    </Aberto>
  );
}

/** Agrupado por projeto, com contador de dois dígitos no badge. */
export function PainelComVariosProjetos() {
  return (
    <Aberto>
      <NotificationBell groups={variosProjetos} unreadCount={12} onMarkRead={noop} />
    </Aberto>
  );
}

/** Aberto e sem nada — o estado vazio do painel tem texto próprio. */
export function PainelVazio() {
  return (
    <Aberto>
      <NotificationBell groups={[] as Grupos} unreadCount={0} onMarkRead={noop} />
    </Aberto>
  );
}

/** Fechado com pendências: é assim que o sino fica parado na topbar. */
export function FechadoComBadge() {
  return <NotificationBell groups={umProjeto} unreadCount={3} onMarkRead={noop} />;
}

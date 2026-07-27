/*
 * Previews do ActivityFeed.
 *
 * Armadilha que os testes documentam: o feed ESCONDE ruído de máquina
 * (`agent.response`, `tool.call`, `tool.result`, `agent.status`, `agent.delta`,
 * `context.compacted` — ver isMachineEvent em apps/web/src/lib/activity.ts).
 * Um preview montado com esses tipos renderiza só "Nenhuma atividade por aqui
 * ainda", então os eventos abaixo são todos narrativos, escolhidos para cobrir
 * kinds diferentes — é `classifyEvent` que decide quais chips de filtro
 * aparecem, e um feed de um kind só não mostra a barra de filtros.
 */
import { ActivityFeed } from 'web';

type Evento = Parameters<typeof ActivityFeed>[0]['events'][number];

/*
 * O horário de cada linha sai de formatRelativeTime(createdAt), que compara com
 * Date.now(). Uma data FIXA faria o rótulo derivar sozinho — "há 2 h" hoje,
 * "há 30 d" no mês que vem — e o texto renderizado mudando invalida a grade
 * deste componente em todo sync futuro. Por isso o minuto é um OFFSET a partir
 * de agora: o rótulo visível fica estável para sempre.
 */
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

const sessaoDeExecucao: Evento[] = [
  evento(48, 'agent.activated', 'dev-backend'),
  evento(45, 'backlog.task_claimed', 'dev-backend', {
    title: 'expor oban_queue_depth no /metrics',
    module: 'engine',
  }),
  evento(31, 'action.git_commit', 'dev-backend', {
    branch: 'feature/dev-backend/oban-metrics',
  }),
  evento(28, 'action.pr_open', 'dev-backend', {
    sourceBranch: 'feature/dev-backend/oban-metrics',
  }),
  evento(19, 'artifact.qa_verdict', 'qa', { veredito: 'changes_requested', taskId: 'task-9' }),
  evento(14, 'backlog.task_blocked', 'dev-backend', {
    reason: 'ciclo de correção do gate esgotado',
  }),
  evento(6, 'permission.granted', 'user', { pattern: 'git push origin feature/*' }),
  evento(2, 'psychologist.hypothesis_proposed', 'psicologo', { agenteAlvo: 'dev-backend' }),
];

const agentes = [
  { id: 'dev-backend', label: 'Dev Backend' },
  { id: 'qa', label: 'QA' },
  { id: 'psicologo', label: 'Psicólogo' },
];

/** Uma sessão de execução real: claim, commit, PR, gate reprovado, bloqueio. */
export function SessaoDeExecucao() {
  return <ActivityFeed events={sessaoDeExecucao} agentOptions={agentes} />;
}

/**
 * Sem `agentOptions` a barra some e sobram só os chips de kind — é assim que o
 * feed aparece dentro da tela de uma sessão única.
 */
export function SemFiltroDeAgente() {
  return <ActivityFeed events={sessaoDeExecucao} />;
}

/**
 * Evidência navegável do Psicólogo: o evento citado é destacado e NUNCA é
 * escondido, mesmo sendo ruído de máquina (aqui, um `tool.result`).
 */
export function EvidenciaDestacada() {
  const citado = evento(11, 'tool.result', 'dev-backend', { tool: 'run_tests' });
  return (
    <ActivityFeed
      events={[...sessaoDeExecucao.slice(0, 4), citado]}
      agentOptions={agentes}
      highlightEventId={citado.id}
    />
  );
}

/** Estado vazio — o que o usuário vê num projeto recém-criado. */
export function Vazio() {
  return <ActivityFeed events={[]} />;
}

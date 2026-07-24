import type { ComponentType } from 'react';
import type { SessionEvent } from './api-types';
import {
  BranchIcon,
  CommitIcon,
  HypothesisIcon,
  PermissionIcon,
  PrIcon,
  SessionIcon,
  StackIcon,
  TerminalIcon,
} from '../components/ui/icons';

export type ActivityKind =
  | 'commit'
  | 'pr'
  | 'hypothesis'
  | 'session'
  | 'permission'
  | 'terminal'
  | 'generic';

export interface ActivityDisplay {
  kind: ActivityKind;
  icon: ComponentType<{ size?: number; className?: string }>;
  color: string;
  bad: boolean;
  text: string;
}

function payloadField(payload: unknown, key: string): string | undefined {
  if (payload && typeof payload === 'object' && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

// Classifica eventos do event log em algo exibível — o backend guarda
// `type` como string livre (ver AppendSessionEventUseCase), então o
// mapeamento é por prefixo/valor conhecido, com fallback genérico.
export function classifyEvent(event: SessionEvent): ActivityDisplay {
  const { type, payload } = event;
  const actorLabel = event.actor.kind === 'agent' ? event.actor.id : event.actor.kind;

  const looksLikeCommit = type === 'action.executed' && payloadField(payload, 'command')?.includes('commit');
  if (type.startsWith('git.commit') || looksLikeCommit) {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--text-secondary)',
      bad: false,
      text: `${actorLabel} fez commit ${payloadField(payload, 'sha') ?? ''}`.trim(),
    };
  }
  if (type.startsWith('git.push')) {
    return {
      kind: 'commit',
      icon: BranchIcon,
      color: 'var(--text-secondary)',
      bad: false,
      text: `${actorLabel} enviou alterações para ${payloadField(payload, 'branch') ?? 'branch'}`,
    };
  }
  if (type === 'pr.gate_changed') {
    const gate = payloadField(payload, 'gate');
    const veredito = payloadField(payload, 'veredito');
    return {
      kind: 'pr',
      icon: PrIcon,
      color: veredito === 'changes_requested' ? 'var(--danger)' : 'var(--accent)',
      bad: veredito === 'changes_requested',
      text: gate
        ? `gate ${gate}: ${veredito === 'approved' ? 'aprovado' : veredito === 'changes_requested' ? 'mudanças solicitadas' : 'atualizado'}`
        : `${actorLabel} atualizou o gate da PR`,
    };
  }
  if (type === 'infra.gate_changed') {
    const gate = payloadField(payload, 'gate');
    const veredito = payloadField(payload, 'veredito');
    return {
      kind: 'pr',
      icon: PrIcon,
      color: veredito === 'changes_requested' ? 'var(--danger)' : 'var(--accent)',
      bad: veredito === 'changes_requested',
      text: gate
        ? `PR de infra · gate ${gate}: ${veredito === 'approved' ? 'aprovado' : veredito === 'changes_requested' ? 'mudanças solicitadas' : 'atualizado'}`
        : `${actorLabel} atualizou o gate da PR de infra`,
    };
  }
  if (type.startsWith('pr.') || type.startsWith('pr_open')) {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} abriu pull request${payloadField(payload, 'title') ? `: ${payloadField(payload, 'title')}` : ''}`,
    };
  }
  if (type === 'artifact.qa_verdict' || type === 'artifact.secops_verdict') {
    const gateLabel = type === 'artifact.qa_verdict' ? 'QA' : 'SecOps';
    const veredito = payloadField(payload, 'veredito');
    const approved = veredito === 'approved';
    // Parecer de gate de PR de infra (InfraGateRunner) tem `prActionId` no
    // payload em vez de `taskId` (o dev) — só o texto deixa claro a origem.
    const isInfra = payloadField(payload, 'prActionId') !== undefined;
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: approved ? 'var(--success)' : 'var(--danger)',
      bad: !approved,
      text: `${gateLabel}${isInfra ? ' (PR de infra)' : ''}: ${approved ? 'aprovado' : 'mudanças solicitadas'}`,
    };
  }
  if (type.startsWith('artifact.')) {
    const artifactKind = type.slice('artifact.'.length);
    const label =
      artifactKind === 'business_rule'
        ? `${actorLabel} registrou uma regra de negócio`
        : artifactKind === 'product_brief'
          ? `${actorLabel} consolidou o product brief`
          : artifactKind === 'module_map'
            ? `${actorLabel} definiu o mapa de módulos`
            : artifactKind === 'insight'
              ? `${actorLabel} registrou um insight de arquitetura`
              : `${actorLabel} emitiu um artefato (${artifactKind})`;
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: '#9C7BE0',
      bad: false,
      text: label,
    };
  }
  if (type === 'dev.blocked') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--danger)',
      bad: true,
      text: `${actorLabel} bloqueou a task: ${payloadField(payload, 'reason') ?? 'sem motivo informado'}`,
    };
  }
  if (type.startsWith('dev.')) {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: type.includes('error') ? 'var(--danger)' : 'var(--text-secondary)',
      bad: type.includes('error'),
      text:
        type === 'dev.working'
          ? `${actorLabel} está implementando (${payloadField(payload, 'branch') ?? 'branch'})`
          : type === 'dev.started'
            ? `${actorLabel} começou a trabalhar`
            : type === 'dev.idle'
              ? `${actorLabel} sem tarefa disponível`
              : `${actorLabel} · ${type}`,
    };
  }
  if (type.startsWith('execution.')) {
    return {
      kind: 'session',
      icon: StackIcon,
      color: 'var(--accent)',
      bad: false,
      text:
        type === 'execution.activated'
          ? 'execução ativada'
          : type === 'execution.parallelization_suggested'
            ? `sugestão: dev extra para ${payloadField(payload, 'module') ?? 'um módulo'}`
            : type === 'execution.parallelization_accepted'
              ? `dev extra aceito para ${payloadField(payload, 'module') ?? 'um módulo'}`
              : `execução · ${type}`,
    };
  }
  if (type === 'backlog.story_demoted') {
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--danger)',
      bad: true,
      text: `história rebaixada a draft (módulo removido do module_map)`,
    };
  }
  if (type.startsWith('adr.')) {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: type.includes('failed') ? 'var(--danger)' : 'var(--accent)',
      bad: type.includes('failed'),
      text:
        type === 'adr.pr_opened'
          ? `PR de ADR aberta no repositório`
          : `falha ao abrir a PR de ADR`,
    };
  }
  if (type === 'infra.artifact_blocked') {
    return {
      kind: 'commit',
      icon: CommitIcon,
      color: 'var(--danger)',
      bad: true,
      text: `PR de infra bloqueada: ${payloadField(payload, 'reason') ?? 'ciclo de correção esgotado'}`,
    };
  }
  if (type.startsWith('infra.')) {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: type.includes('failed') ? 'var(--danger)' : 'var(--accent)',
      bad: type.includes('failed'),
      text:
        type === 'infra.pr_opened'
          ? `PR de infra aberta no repositório${payloadField(payload, 'title') ? `: ${payloadField(payload, 'title')}` : ''}`
          : type === 'infra.pr_failed'
            ? 'falha ao abrir a PR de infra'
            : `infra · ${type}`,
    };
  }
  if (type.startsWith('backlog.')) {
    const what = type.slice('backlog.'.length).replace('_created', '');
    const label =
      what === 'epic'
        ? 'criou um épico'
        : what === 'story'
          ? 'criou uma história'
          : what === 'task'
            ? 'criou uma tarefa'
            : 'atualizou o backlog';
    return {
      kind: 'generic',
      icon: StackIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} ${label}`,
    };
  }
  if (type === 'architecture.readiness_confirmed') {
    return {
      kind: 'session',
      icon: StackIcon,
      color: 'var(--accent)',
      bad: false,
      text: 'usuário confirmou a arquitetura pronta — handoff para o InfraAgent oferecido',
    };
  }
  if (type.startsWith('handoff.')) {
    return {
      kind: 'generic',
      icon: PrIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} ofereceu um handoff para ${payloadField(payload, 'toAgent') ?? 'outro agente'}`,
    };
  }
  if (type.startsWith('hypothesis')) {
    return {
      kind: 'hypothesis',
      icon: HypothesisIcon,
      color: '#9C7BE0',
      bad: false,
      text: `${actorLabel} registrou uma hipótese`,
    };
  }
  if (type.includes('closed_abnormally')) {
    return {
      kind: 'session',
      icon: SessionIcon,
      color: 'var(--danger)',
      bad: true,
      text: 'Sessão encerrada de forma anormal',
    };
  }
  if (type.startsWith('permission.')) {
    const granted = type.includes('grant') || type.includes('always');
    return {
      kind: 'permission',
      icon: PermissionIcon,
      color: granted ? 'var(--success)' : 'var(--danger)',
      bad: !granted,
      text: granted
        ? `${actorLabel} concedeu permissão${payloadField(payload, 'pattern') ? ` para ${payloadField(payload, 'pattern')}` : ''}`
        : `${actorLabel} negou permissão`,
    };
  }
  if (type.startsWith('action.') || type.startsWith('terminal')) {
    return {
      kind: 'terminal',
      icon: TerminalIcon,
      color: type.includes('failed') ? 'var(--danger)' : 'var(--text-secondary)',
      bad: type.includes('failed'),
      text: `${actorLabel} ${type.includes('failed') ? 'falhou ao executar comando' : 'executou um comando'}`,
    };
  }

  return {
    kind: 'generic',
    icon: SessionIcon,
    color: 'var(--text-secondary)',
    bad: false,
    text: `${actorLabel} · ${type}`,
  };
}

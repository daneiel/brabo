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
  if (type.startsWith('pr.') || type.startsWith('pr_open')) {
    return {
      kind: 'pr',
      icon: PrIcon,
      color: 'var(--accent)',
      bad: false,
      text: `${actorLabel} abriu pull request${payloadField(payload, 'title') ? `: ${payloadField(payload, 'title')}` : ''}`,
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

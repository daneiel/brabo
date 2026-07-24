import type { ComponentType } from 'react';
import {
  BulbIcon,
  ClockIcon,
  CodeIcon,
  HypothesisIcon,
  LayoutSidebarIcon,
  LockIcon,
  PermissionIcon,
  ServerIcon,
  StackIcon,
  UserIcon,
} from '../components/ui/icons';

// Roster fixo dos agentes (CLAUDE.md) — cor e ícone consistentes em toda
// a UI (chat, overview do projeto, feed de atividade). Ver design/COMPONENTS.md.
export type AgentKey =
  | 'psicologo'
  | 'psicologo-leve'
  | 'anamnese'
  | 'criativo'
  | 'arquiteto'
  | 'po'
  | 'dev-backend'
  | 'dev-frontend'
  | 'infra'
  | 'qa'
  | 'secops';

export interface AgentDef {
  key: AgentKey;
  name: string;
  role: string;
  color: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

export const AGENTS: Record<AgentKey, AgentDef> = {
  psicologo: {
    key: 'psicologo',
    name: 'Psicólogo',
    role: 'Anamnese emocional do time',
    color: '#9C7BE0',
    icon: HypothesisIcon,
  },
  // Tier barato da triagem do Psicólogo (Fase 4b) — entra no roster pra
  // aparecer na tabela de bindings de modelo (ProjectSettingsTab), já que
  // é o binding dele que torna a análise leve realmente mais barata.
  'psicologo-leve': {
    key: 'psicologo-leve',
    name: 'Psicólogo (leve)',
    role: 'Triagem econômica de sessões simples',
    color: '#B9A5E8',
    icon: HypothesisIcon,
  },
  anamnese: {
    key: 'anamnese',
    name: 'Anamnese',
    role: 'Levantamento de contexto inicial',
    color: 'var(--success)',
    icon: ClockIcon,
  },
  criativo: {
    key: 'criativo',
    name: 'Criativo',
    role: 'Ideação e direção de produto',
    color: 'var(--warning)',
    icon: BulbIcon,
  },
  arquiteto: {
    key: 'arquiteto',
    name: 'Arquiteto',
    role: 'Design técnico e decisões estruturais',
    color: 'var(--accent)',
    icon: StackIcon,
  },
  po: {
    key: 'po',
    name: 'PO',
    role: 'Priorização e backlog',
    color: '#9C7BE0',
    icon: UserIcon,
  },
  'dev-backend': {
    key: 'dev-backend',
    name: 'Dev Backend',
    role: 'Implementação de API e domínio',
    color: 'var(--success)',
    icon: CodeIcon,
  },
  'dev-frontend': {
    key: 'dev-frontend',
    name: 'Dev Frontend',
    role: 'Implementação de interface',
    color: '#5EBEB1',
    icon: LayoutSidebarIcon,
  },
  infra: {
    key: 'infra',
    name: 'Infra',
    role: 'Provisionamento e operação',
    color: 'var(--warning)',
    icon: ServerIcon,
  },
  qa: {
    key: 'qa',
    name: 'QA',
    role: 'Verificação e testes',
    color: 'var(--danger)',
    icon: PermissionIcon,
  },
  secops: {
    key: 'secops',
    name: 'SecOps',
    role: 'Segurança e conformidade',
    color: '#8AA6AE',
    icon: LockIcon,
  },
};

export const AGENT_LIST: AgentDef[] = Object.values(AGENTS);

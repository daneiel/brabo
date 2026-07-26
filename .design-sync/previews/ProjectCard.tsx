/*
 * Previews do ProjectCard — o card da lista de projetos.
 *
 * `agents` é uma lista de AgentDef (nome, cor e ícone saem dela; a cor entra
 * por `--agent-color` nos avatares). O mapa AGENTS não é exportado pelo
 * bundle, então os objetos abaixo repetem os valores reais de
 * apps/web/src/lib/agents.ts.
 */
import {
  ProjectCard,
  CodeIcon,
  LayoutSidebarIcon,
  PermissionIcon,
  ServerIcon,
  StackIcon,
  LockIcon,
} from 'web';

const noop = () => {};

const time = [
  { key: 'arquiteto' as const, name: 'Arquiteto', role: 'Design técnico e decisões estruturais', color: 'var(--accent)', icon: StackIcon },
  { key: 'dev-backend' as const, name: 'Dev Backend', role: 'Implementação de API e domínio', color: 'var(--success)', icon: CodeIcon },
  { key: 'dev-frontend' as const, name: 'Dev Frontend', role: 'Implementação de interface', color: '#5EBEB1', icon: LayoutSidebarIcon },
  { key: 'qa' as const, name: 'QA', role: 'Verificação e testes', color: 'var(--danger)', icon: PermissionIcon },
  { key: 'secops' as const, name: 'SecOps', role: 'Segurança e conformidade', color: '#8AA6AE', icon: LockIcon },
  { key: 'infra' as const, name: 'Infra', role: 'Provisionamento e operação', color: 'var(--warning)', icon: ServerIcon },
];

/** Projeto provisionado no GitHub, em uso, com pendências não lidas. */
export function EmAndamento() {
  return (
    <ProjectCard
      name="plataforma-de-pagamentos"
      provider="github"
      provisioningStatus="provisioned"
      agents={time}
      tokensUsed={184_320}
      tokensLimit={500_000}
      costBRL={12.47}
      costUSD={2.29}
      lastActivityText="dev-backend abriu PR há 18 min"
      unreadCount={3}
      onClick={noop}
    />
  );
}

/** Provisionando: o wizard ainda está montando o Gitflow no repositório. */
export function Provisionando() {
  return (
    <ProjectCard
      name="portal-do-cliente"
      provider="gitlab"
      provisioningStatus="provisioning"
      agents={time.slice(0, 3)}
      tokensUsed={0}
      tokensLimit={500_000}
      costBRL={0}
      costUSD={0}
      lastActivityText="criando as branches permanentes"
      onClick={noop}
    />
  );
}

/** Falha no provisionamento — o card tem que ser retomável, não um beco. */
export function FalhaNoProvisionamento() {
  return (
    <ProjectCard
      name="brabo-interno"
      provider="local"
      provisioningStatus="provision_failed"
      agents={time.slice(0, 2)}
      tokensUsed={4_120}
      tokensLimit={500_000}
      costBRL={0.28}
      costUSD={0.05}
      lastActivityText="falhou ao proteger as branches"
      onClick={noop}
    />
  );
}

/** Perto do teto de orçamento, com contador de dois dígitos. */
export function QuaseNoLimite() {
  return (
    <ProjectCard
      name="motor-de-cobranca"
      provider="github"
      provisioningStatus="provisioned"
      agents={time}
      tokensUsed={487_600}
      tokensLimit={500_000}
      costBRL={33.12}
      costUSD={6.08}
      lastActivityText="QA pediu mudanças há 2 min"
      unreadCount={12}
      onClick={noop}
    />
  );
}

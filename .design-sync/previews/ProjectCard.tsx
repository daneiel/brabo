/*
 * Previews do ProjectCard — o card da lista de projetos.
 *
 * A prop mudou de `agents` (lista plana de AgentDef) para `rosterGroups`, que
 * é o agrupamento por ÁREA do ADR 0038: um grupo `solo` vira um chip; um grupo
 * `area` vira UM chip do lead com a contagem (`QA ×3` = lead + 2 subagentes).
 * É o que faz a subespecialidade aparecer sem virar avatar à parte.
 *
 * `AGENTS`/`AGENT_LIST` não são exportados pelo bundle, então os `def` abaixo
 * repetem os valores reais de apps/web/src/lib/agents.ts, e o agrupamento é
 * escrito à mão em vez de sair de `groupRosterByArea` (que também não é
 * exportado).
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

const def = {
  arquiteto: { key: 'arquiteto' as const, name: 'Arquiteto', initials: 'AR', role: 'Design técnico e decisões estruturais', color: 'var(--accent)', icon: StackIcon },
  devBackend: { key: 'dev-backend' as const, name: 'Dev Backend', initials: 'BE', role: 'Implementação de API e domínio', color: 'var(--success)', icon: CodeIcon },
  devFrontend: { key: 'dev-frontend' as const, name: 'Dev Frontend', initials: 'FE', role: 'Implementação de interface', color: '#5EBEB1', icon: LayoutSidebarIcon },
  qa: { key: 'qa' as const, name: 'QA', initials: 'QA', role: 'Verificação e testes', color: 'var(--danger)', icon: PermissionIcon },
  qaAutomacao: { key: 'qa-automacao' as const, name: 'QA de Automação', initials: 'QA', role: 'Suite automatizada', color: 'var(--danger)', icon: PermissionIcon },
  qaPerf: { key: 'qa-performance-seguranca' as const, name: 'QA de Performance e Segurança', initials: 'QP', role: 'Carga e superfície', color: 'var(--danger)', icon: PermissionIcon },
  secops: { key: 'secops' as const, name: 'SecOps', initials: 'SO', role: 'Segurança e conformidade', color: '#8AA6AE', icon: LockIcon },
  infra: { key: 'infra' as const, name: 'Infra', initials: 'IN', role: 'Provisionamento e operação', color: 'var(--warning)', icon: ServerIcon },
};

const entrada = (d: (typeof def)[keyof typeof def], status = 'trabalhando' as const) => ({
  id: d.key,
  def: d,
  status,
});

/** Solos + a área de QA como um chip só, que é o caso que o ADR 0038 criou. */
const time = [
  { kind: 'solo' as const, entry: entrada(def.arquiteto) },
  { kind: 'solo' as const, entry: entrada(def.devBackend) },
  { kind: 'solo' as const, entry: entrada(def.devFrontend, 'ocioso') },
  {
    kind: 'area' as const,
    areaKey: 'qa',
    lead: entrada(def.qa, 'aguardando'),
    members: [entrada(def.qaAutomacao), entrada(def.qaPerf)],
  },
  { kind: 'solo' as const, entry: entrada(def.secops, 'ocioso') },
  { kind: 'solo' as const, entry: entrada(def.infra, 'ocioso') },
];

/** Projeto provisionado no GitHub, em uso, com pendências não lidas. */
export function EmAndamento() {
  return (
    <ProjectCard
      name="plataforma-de-pagamentos"
      provider="github"
      provisioningStatus="provisioned"
      rosterGroups={time}
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
      rosterGroups={time.slice(0, 3)}
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
      rosterGroups={time.slice(0, 2)}
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
      rosterGroups={time}
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

/**
 * Projeto SEM orçamento definido: o card troca o medidor de tokens por um
 * convite a definir o teto. É o estado inicial de todo projeto novo — e o que
 * o dashboard mostra hoje —, então precisa estar entre os previews.
 */
export function SemOrcamento() {
  return (
    <ProjectCard
      name="core-api"
      provider="local"
      provisioningStatus="provisioned"
      rosterGroups={time.slice(0, 3)}
      tokensUsed={0}
      tokensLimit={0}
      costBRL={0}
      costUSD={0}
      noBudget
      onDefineBudget={noop}
      lastActivityText="atividade em llama3.2:1b · há 5 d"
      onClick={noop}
    />
  );
}


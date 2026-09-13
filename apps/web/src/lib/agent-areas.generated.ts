/**
 * GERADO por `pnpm --filter api gerar:areas` a partir de
 * `apps/api/src/domain/agents/agent-areas.ts`. NÃO edite à mão: a próxima
 * geração sobrescreve, e o teste `agent-areas.spec.ts` reprova a divergência.
 *
 * A área de `dev` sai daqui com `members` vazio, e não é omissão: os
 * membros dela são um por módulo do `module_map`, por projeto, e vêm de
 * `agent_areas`/`agent_area_members` (RN-094).
 */
import type { AgentKey, AreaDef } from './agents';

export const AREAS: Record<string, AreaDef> = {
  dev: {
    key: 'dev',
    label: 'Dev',
    lead: 'dev-lead',
    members: [],
  },
  qa: {
    key: 'qa',
    label: 'QA',
    lead: 'qa',
    members: ['qa-automacao', 'qa-performance-seguranca'],
  },
  infra: {
    key: 'infra',
    label: 'Infra',
    lead: 'infra',
    members: ['infra-workflows'],
  },
};

/**
 * Agentes conversacionais SOLO — sem área, sem subagentes (ADR 0109).
 * `satisfies` e não anotação: um nome fora de `AgentKey` quebra o build
 * do web, e a lista segue com os literais (nenhum cast alarga o tipo).
 */
export const SOLO_CONVERSATIONAL_AGENTS = [
  'criativo',
  'po',
  'arquiteto',
  'ux-designer',
  'staff',
] as const satisfies readonly AgentKey[];

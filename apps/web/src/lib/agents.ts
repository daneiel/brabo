import type { ComponentType } from 'react';
import { AREAS } from './agent-areas.generated';
import {
  BulbIcon,
  ClockIcon,
  CodeIcon,
  DeployIcon,
  FileIcon,
  GaugeIcon,
  HypothesisIcon,
  LayoutSidebarIcon,
  LockIcon,
  PencilIcon,
  PermissionIcon,
  ServerIcon,
  StackIcon,
  UserIcon,
} from '../components/ui/icons';

// Roster fixo dos agentes (CLAUDE.md) — cor e ícone consistentes em toda
// a UI (chat, overview do projeto, feed de atividade). Ver design/COMPONENTS.md.
//
// `qa-automacao`/`qa-performance-seguranca`/`infra-workflows` (Fase 8d) são
// SUBAGENTES de área (ADR 0038, Fases 8b/8c) — `qa`/`infra` continuam sendo
// os LEADS (contato externo inalterado). Ver `AREAS`/`areaFor` abaixo pra a
// relação entre eles.
export type AgentKey =
  | 'psicologo'
  | 'psicologo-leve'
  | 'anamnese'
  | 'criativo'
  | 'arquiteto'
  | 'po'
  | 'ux-designer'
  | 'staff'
  | 'dev-lead'
  | 'dev-backend'
  | 'dev-frontend'
  | 'infra'
  | 'infra-workflows'
  | 'qa'
  | 'qa-automacao'
  | 'qa-performance-seguranca'
  | 'secops';

export interface AgentDef {
  key: AgentKey;
  name: string;
  /**
   * Duas letras para o avatar quadrado da tela de Configurações
   * (`design/SCREENS.md`). Escritas, não derivadas do nome: o desenho abrevia
   * "Dev Backend" como BE e "Dev Frontend" como FE — regra nenhuma sobre o
   * nome produz isso.
   */
  initials: string;
  role: string;
  /**
   * Cor do agente, sempre um `var(--token)` quando existe token para ela.
   *
   * Três valores AINDA são hex solto, e são declarados aqui em vez de
   * convertidos: `#B9A5E8` (Psicólogo leve), `#5EBEB1` (Dev Frontend) e
   * `#8AA6AE` (SecOps) não têm contraparte semântica em `design/tokens.css`, e
   * inventar um token para cada um seria abrir três cores novas no design
   * system de passagem. A consequência é conhecida e está no ADR 0074: esses
   * três não mudam com o tema — foram escolhidos contra o fundo escuro e no
   * tema claro ficam mais lavados que os outros. Token de cor de agente é
   * decisão de produto, não correção de caminho.
   */
  color: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

export const AGENTS: Record<AgentKey, AgentDef> = {
  psicologo: {
    key: 'psicologo',
    name: 'Psicólogo',
    initials: 'PS',
    role: 'Anamnese emocional do time',
    color: 'var(--violet)',
    icon: HypothesisIcon,
  },
  // Tier barato da triagem do Psicólogo (Fase 4b) — entra no roster pra
  // aparecer na tabela de bindings de modelo (ProjectSettingsTab), já que
  // é o binding dele que torna a análise leve realmente mais barata.
  'psicologo-leve': {
    key: 'psicologo-leve',
    name: 'Psicólogo (leve)',
    initials: 'PL',
    role: 'Triagem econômica de sessões simples',
    color: '#B9A5E8',
    icon: HypothesisIcon,
  },
  anamnese: {
    key: 'anamnese',
    name: 'Anamnese',
    initials: 'AN',
    role: 'Levantamento de contexto inicial',
    color: 'var(--success)',
    icon: ClockIcon,
  },
  criativo: {
    key: 'criativo',
    name: 'Criativo',
    initials: 'CR',
    role: 'Ideação e direção de produto',
    color: 'var(--warning)',
    icon: BulbIcon,
  },
  arquiteto: {
    key: 'arquiteto',
    name: 'Arquiteto',
    initials: 'AR',
    role: 'Design técnico e decisões estruturais',
    color: 'var(--accent)',
    icon: StackIcon,
  },
  po: {
    key: 'po',
    name: 'PO',
    initials: 'PO',
    role: 'Priorização e backlog',
    color: 'var(--violet)',
    icon: UserIcon,
  },
  // Quinto agente conversacional (ADR 0087, `docs/fluxo.yml` id `ux-designer`
  // — status `active`, antecipado pelo dono do produto antes do gatilho de
  // separação declarado ter disparado). SOLO, sem área. `--accent` é o token
  // semântico menos reusado do roster (só o Arquiteto o usava até aqui) —
  // nenhum dos cinco tokens semânticos de `design/tokens.css` está livre de
  // outro agente, e a regra do design system proíbe inventar hex novo.
  'ux-designer': {
    key: 'ux-designer',
    name: 'UX Designer',
    initials: 'UX',
    role: 'Personas, jornadas e protótipo navegável',
    color: 'var(--accent)',
    icon: PencilIcon,
  },
  // Staff/Principal Engineer (docs/fluxo.yml, camada_decisao_tecnica, ADR
  // 0088) — RFC + PoC descartável para problema sistêmico RECORRENTE,
  // devolvido ao Arquiteto por handoff. Dormente para disparo AUTOMÁTICO
  // (a Anamnese, que o dispararia, está pausada — ANAMNESE_ENABLED=false);
  // acionável MANUALMENTE por handoff aceito, mesmo mecanismo genérico dos
  // demais leads (sem entrar em USER_STARTED_AGENTS).
  staff: {
    key: 'staff',
    name: 'Staff',
    initials: 'ST',
    role: 'Parecer sistêmico e RFC',
    color: 'var(--violet)',
    icon: FileIcon,
  },
  'dev-lead': {
    key: 'dev-lead',
    name: 'Dev Lead',
    initials: 'DL',
    role: 'Distribui o trabalho de implementação e responde por ele',
    color: 'var(--success)',
    icon: LayoutSidebarIcon,
  },
  'dev-backend': {
    key: 'dev-backend',
    name: 'Dev Backend',
    initials: 'BE',
    role: 'Implementação de API e domínio',
    color: 'var(--success)',
    icon: CodeIcon,
  },
  'dev-frontend': {
    key: 'dev-frontend',
    name: 'Dev Frontend',
    initials: 'FE',
    role: 'Implementação de interface',
    color: '#5EBEB1',
    icon: LayoutSidebarIcon,
  },
  infra: {
    key: 'infra',
    name: 'Infra',
    initials: 'IN',
    role: 'Provisionamento e operação',
    color: 'var(--warning)',
    icon: ServerIcon,
  },
  // Subagente da área de Infra (Fase 8c/8d) — gera o pipeline de CI,
  // delegado pelo lead `infra`. Mesma cor do lead, de propósito: é a
  // mesma área, só um ícone diferente pra distinguir o card no painel.
  'infra-workflows': {
    key: 'infra-workflows',
    name: 'Workflows',
    initials: 'WF',
    role: 'Pipeline de CI (GitHub Actions / GitLab CI)',
    color: 'var(--warning)',
    icon: DeployIcon,
  },
  qa: {
    key: 'qa',
    name: 'QA',
    initials: 'QA',
    role: 'Verificação e testes',
    color: 'var(--danger)',
    icon: PermissionIcon,
  },
  // Subespecialidades da área de QA (Fase 8b/8d) — delegadas pelo lead
  // `qa`. Mesma cor do lead, ícone próprio por papel.
  'qa-automacao': {
    key: 'qa-automacao',
    name: 'QA de Automação',
    initials: 'QA',
    role: 'Suite de testes e coverage_matrix',
    color: 'var(--danger)',
    icon: CodeIcon,
  },
  'qa-performance-seguranca': {
    key: 'qa-performance-seguranca',
    name: 'QA de Performance e Segurança',
    initials: 'QP',
    role: 'RNFs de performance e apoio de segurança em nível de código',
    color: 'var(--danger)',
    icon: GaugeIcon,
  },
  secops: {
    key: 'secops',
    name: 'SecOps',
    initials: 'SO',
    role: 'Segurança e conformidade',
    color: '#8AA6AE',
    icon: LockIcon,
  },
};

export const AGENT_LIST: AgentDef[] = Object.values(AGENTS);

/** Área da hierarquia de agentes (ADR 0038, Fases 8b/8c): um lead + subagentes. */
export interface AreaDef {
  key: string;
  label: string;
  lead: AgentKey;
  members: AgentKey[];
}

/**
 * As áreas, DERIVADAS da api (FASE 18).
 *
 * A lista era escrita aqui à mão e travada por teste contra a cópia da api —
 * duas listas que combinavam de não divergir. Agora a fonte é
 * `apps/api/src/domain/agents/agent-areas.ts` e este módulo só reexporta o que
 * `pnpm --filter api gerar:areas` escreveu: editar à mão é reprovado.
 *
 * A área de `dev` continua com `members` vazio, e não é omissão — os membros
 * dela são um por módulo do `module_map`, por projeto, e vêm de
 * `agent_areas`/`agent_area_members` (RN-094). Quem endereça a execução de
 * fora é o lead.
 */
export { AREAS };

/**
 * Área de um agente, se houver — pelo `AgentKey` do LEAD ou de um MEMBRO
 * (`agentKey` aceita string solta porque `agenteAlvo`/`actor.id` no wire
 * nunca são tipados como `AgentKey`, ver `api-types.ts`). `undefined` pra
 * qualquer agente sem área (Criativo, PO, Arquiteto, dev-*, Psicólogo,
 * Anamnese) — o chamador decide o fallback.
 */
export function areaFor(agentKey: string): AreaDef | undefined {
  return Object.values(AREAS).find(
    (area) => area.lead === agentKey || (area.members as string[]).includes(agentKey),
  );
}

/**
 * Agentes conversacionais SOLO — sem área, sem subagentes. Mirror MANUAL de
 * `SOLO_CONVERSATIONAL_AGENTS` em
 * `apps/api/src/domain/agents/agent-areas.ts` (ADR 0109/RN-440) — não vem do
 * gerador (que só cobre `AREAS`), então mudar um lado sem o outro NÃO
 * reprova em teste automático hoje; a validação de VERDADE (quem o backend
 * de fato aceita) mora no `RequestManualHandoffUseCase`, e um alvo
 * desatualizado aqui só produz um 400 tratável na UI, nunca escrita
 * indevida. Lacuna aceita — cruzar as duas listas por teste exigiria o
 * mesmo mecanismo de `gerar:areas` (Fase 18), fora do escopo desta feature.
 */
export const SOLO_CONVERSATIONAL_AGENTS: AgentKey[] = [
  'criativo',
  'po',
  'arquiteto',
  'ux-designer',
  'staff',
];

/**
 * Handoff manual a agente à escolha (ADR 0109/RN-440): todo agente que a
 * tela pode oferecer no seletor de "Endereçar handoff a..." —
 * leads de área ∪ agentes solo. Mesma regra do backend
 * (`addressableAgents` em `agent-areas.ts`), calculada aqui só para
 * povoar o `<Select>`; a validação de VERDADE mora no
 * `RequestManualHandoffUseCase`, do lado do servidor.
 */
export function addressableAgents(): AgentKey[] {
  const leads = Object.values(AREAS).map((area) => area.lead);
  return [...new Set([...leads, ...SOLO_CONVERSATIONAL_AGENTS])];
}

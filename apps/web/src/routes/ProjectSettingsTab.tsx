import { useState, type CSSProperties } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  addProjectMember,
  deleteMyProficiency,
  getProject,
  getProjectEvent,
  listProjectInstructionVersions,
  optInProficiency,
  runAnamnese,
  rollbackInstruction,
  deleteCredential,
  getAgentModelBinding,
  getBootstrapPlan,
  getProjectAgentCosts,
  getProjectModelBinding,
  getRepository,
  getWorkspaceModelBinding,
  listCredentials,
  listModels,
  listAgentAreas,
  listProjectMembers,
  removeProjectMember,
  mensagemDaApi,
  setAgentModelBinding,
  setAreaMaxParallel,
  testCredential,
  updateProject,
  upsertCredential,
} from '../lib/api-client';
import { AGENT_LIST } from '../lib/agents';
import { useProficiency } from '../lib/hooks';
import { pollQueParaNoErro } from '../lib/query-policy';
import { ROLE_LABEL, ROLE_ORDER } from '../lib/roles';
import type {
  Model,
  ModelBindingScope,
  ResolvedBinding,
  ProficiencyLevel,
  ProficiencyProfile,
  Role,
  StoryPromotionMode,
} from '../lib/api-types';
import {
  CREDENCIAIS_DE_LLM,
  type LlmCredentialProvider,
} from '../lib/models';
import { divergencias } from '../lib/adoption';
import { microsParaUsd, usdFmt } from '../lib/currency';
import { Alert } from '../components/ui/Alert';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ModelPicker } from '../components/ModelPicker';
import { ModelCatalogSection } from '../components/ModelCatalogSection';
import { CredentialSpendSection } from '../components/CredentialSpendSection';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { BranchIcon, ClockIcon, TrashIcon } from '../components/ui/icons';
import { useToast } from '../components/ui/ToastProvider';
import styles from './ProjectSettingsTab.module.css';

const ORIGIN_TONE: Record<ModelBindingScope, BadgeTone> = {
  workspace: 'muted',
  project: 'warning',
  agent: 'accent',
  session: 'success',
};

const MATRIX_ROWS: { label: string; minRole: Role }[] = [
  { label: 'Merge / abrir PR', minRole: 'maintainer' },
  { label: 'Deploy em produção', minRole: 'maintainer' },
  { label: 'Comando privilegiado', minRole: 'developer' },
  { label: 'Alterar schema/migração', minRole: 'developer' },
  { label: 'Editar permissions.json', minRole: 'maintainer' },
];

/** Duas letras a partir do nome (ou do e-mail, quando não há nome). */
function iniciaisDe(rotulo: string): string {
  const partes = rotulo.split(/[\s@._-]+/u).filter(Boolean);
  const letras =
    partes.length >= 2
      ? partes[0][0] + partes[1][0]
      : (partes[0] ?? '?').slice(0, 2);
  return letras.toUpperCase();
}

/**
 * O avatar do membro é um GRADIENTE no desenho — é o que o distingue do avatar
 * do agente, que tem cor chapada e anel. As duas pontas saem de um hash do
 * e-mail: a mesma pessoa fica com o mesmo par em qualquer tela, e ninguém
 * precisa cadastrar cor de avatar.
 */
const PARES_DE_GRADIENTE = [
  ['var(--accent)', 'var(--warning)'],
  ['var(--success)', 'var(--accent)'],
  ['var(--warning)', 'var(--danger)'],
  ['var(--success)', 'var(--border-strong)'],
  ['var(--danger)', 'var(--accent)'],
] as const;

function gradienteDe(email: string): CSSProperties {
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  const [de, para] = PARES_DE_GRADIENTE[hash % PARES_DE_GRADIENTE.length];
  return { ['--membro-de']: de, ['--membro-para']: para } as CSSProperties;
}

/**
 * Custo em USD. O mockup mostra `R$ 640,10 · US$ 116`, mas converter exigiria
 * uma taxa de câmbio — e "preferência de moeda com taxa manual" é backlog
 * declarado no CLAUDE.md. Um número em reais tirado de taxa inventada seria
 * pior que um número honesto em dólar.
 *
 * Abaixo de um centavo NÃO vira `US$ 0,00`. Preço de token é da ordem de 10⁻⁶,
 * e na primeira versão desta tela um agente que gastou 1811 micro-USD aparecia
 * com o mesmo `US$ 0,00` de um agente que não gastou nada — a coluna afirmava
 * ausência de consumo onde havia consumo. `< US$ 0,01` diz a verdade sem
 * encher a coluna de casas decimais que ninguém compara.
 */
function formatarCustoMicros(micros: number): string {
  if (micros === 0) return usdFmt.format(0);
  const usd = microsParaUsd(micros);
  if (usd < 0.01) return `< ${usdFmt.format(0.01)}`;
  return usdFmt.format(usd);
}

/**
 * A sigla de duas letras do chip do conector (handoff, seção 7 item 4).
 *
 * NÃO é `iniciaisDe`: aquela quebra por espaço, e "OpenAI" e "OpenRouter" são
 * uma palavra só — as duas saíam como `OP`, dois conectores com o mesmo
 * distintivo lado a lado. As MAIÚSCULAS do nome distinguem (`OA` e `OR`), e
 * quando só há uma (Anthropic, Vultr) valem as duas primeiras letras.
 */
export function siglaDoConector(label: string): string {
  const maiusculas = label.replace(/[^A-Za-z]/gu, '').match(/[A-Z]/gu) ?? [];
  const letras =
    maiusculas.length >= 2 ? maiusculas.slice(0, 2).join('') : label.slice(0, 2);
  return letras.toUpperCase();
}

/**
 * A cor da borda esquerda de cada conector (handoff, seção 7 item 4). Só tokens
 * semânticos — o handoff nomeia terracota para a Anthropic e teal para a
 * OpenAI, e os demais seguem o mesmo repertório de quatro acentos.
 *
 * `Record<LlmCredentialProvider, …>` de propósito: provider novo entra na lista
 * derivando de `ROTULO_DO_PROVIDER`, e é o compilador que cobra a cor aqui em
 * vez de ele nascer sem borda nenhuma.
 */
const COR_DO_CONECTOR: Record<LlmCredentialProvider, string> = {
  anthropic: 'var(--accent)',
  openai: 'var(--success)',
  openrouter: 'var(--violet)',
  'nvidia-nim': 'var(--success)',
  together: 'var(--warning)',
  deepinfra: 'var(--violet)',
  bitdeer: 'var(--accent)',
  vultr: 'var(--warning)',
};

const LEVEL_TONE: Record<ProficiencyLevel, BadgeTone> = {
  iniciante: 'muted',
  intermediario: 'warning',
  avancado: 'success',
};

interface ProjectSettingsTabProps {
  projectId: string;
}

export function ProjectSettingsTab({ projectId }: ProjectSettingsTabProps) {
  return (
    <div>
      <RepositorySection projectId={projectId} />
      <ExecutionSection projectId={projectId} />
      <ParallelismSection projectId={projectId} />
      <PromotionSection projectId={projectId} />
      <ModelsSection projectId={projectId} />
      <CatalogoDeModelos projectId={projectId} />
      <MembersSection projectId={projectId} />
      <ProficiencySection projectId={projectId} />
      <InstructionVersionsSection projectId={projectId} />
      <MatrixSection />
      <CredentialsSection />
      <GastoDasChaves projectId={projectId} />
    </div>
  );
}

/**
 * O catálogo é global, mas a curadoria pende do workspace: é de lá que o
 * `RolesGuard` tira o papel (só `owner` ativa). Daí a busca do projeto só para
 * descobrir a que workspace ele pertence.
 */
function CatalogoDeModelos({ projectId }: { projectId: string }) {
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  if (!project) return null;
  return <ModelCatalogSection workspaceId={project.workspaceId} />;
}

/**
 * O relatório de gasto das chaves — só para o OWNER (RN-060).
 *
 * A rota exige `owner` no workspace. A tela não a chama sem o papel: pedir um
 * 403 de propósito enche o log de segurança de ruído e deixa a seção piscando
 * um erro para quem simplesmente não é o dono.
 */
function GastoDasChaves({ projectId }: { projectId: string }) {
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const { data: comPapel } = useCurrentWorkspaceWithRole();

  if (!project || comPapel?.role !== 'owner') return null;
  return <CredentialSpendSection workspaceId={project.workspaceId} />;
}

/**
 * Modelos por agente — a primeira seção do mockup (`design/SCREENS.md`).
 *
 * Cinco colunas, como no desenho: AGENTE, MODELO VIGENTE, ORIGEM, FALLBACK e
 * EST. MÊS. As duas últimas não existiam: `FALLBACK` é derivado aqui a partir
 * dos bindings de projeto e workspace, e `EST. MÊS` vem da rota de custo por
 * agente.
 */
// Exportada para o teste, como as demais seções.
export function ModelsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const { data: modelsByCategory } = useQuery({
    // A chave carrega o projeto porque a lista é do WORKSPACE dele (ADR 0049):
    // um cache global devolveria a curadoria de outro workspace.
    queryKey: ['models', projectId],
    queryFn: () => listModels(projectId),
  });

  const bindingQueries = useQueries({
    queries: AGENT_LIST.map((agent) => ({
      queryKey: ['agent-binding', projectId, agent.key],
      queryFn: () => getAgentModelBinding(projectId, agent.key),
    })),
  });

  // Os dois níveis de cima da cascata, buscados UMA vez — é deles que sai a
  // coluna FALLBACK de todas as linhas.
  const { data: bindingDoProjeto } = useQuery({
    queryKey: ['project-model-binding', projectId],
    queryFn: () => getProjectModelBinding(projectId),
  });
  const { data: bindingDoWorkspace } = useQuery({
    queryKey: ['workspace-model-binding', project?.workspaceId],
    queryFn: () => getWorkspaceModelBinding(project!.workspaceId),
    enabled: Boolean(project?.workspaceId),
  });

  const { data: custos } = useQuery({
    queryKey: ['agent-costs', projectId],
    queryFn: () => getProjectAgentCosts(projectId),
  });

  const allModels: Model[] = modelsByCategory
    ? [...Object.values(modelsByCategory.local).flat(), ...Object.values(modelsByCategory.cloud).flat()]
    : [];

  const nomeDoModelo = (modelId: string | undefined) =>
    allModels.find((m) => m.id === modelId)?.displayName;

  /**
   * O que valeria se o binding vigente sumisse — a precedência é
   * `session > agent > project > workspace` (`domain/llm/binding-resolver.ts`),
   * então o fallback é o binding do nível imediatamente inferior à origem
   * resolvida. Origem `workspace` já é o último nível: não há para onde cair.
   */
  function fallbackDe(origin: ResolvedBinding['origin'] | undefined) {
    if (origin === 'session' || origin === 'agent') {
      return (
        nomeDoModelo(bindingDoProjeto?.modelId) ??
        nomeDoModelo(bindingDoWorkspace?.modelId)
      );
    }
    if (origin === 'project') return nomeDoModelo(bindingDoWorkspace?.modelId);
    return undefined;
  }

  const custoPorAgente = new Map(
    (custos ?? []).map((c) => [c.actorId, c.costMicros]),
  );
  const custoTotalMicros = (custos ?? []).reduce(
    (soma, c) => soma + c.costMicros,
    0,
  );

  async function handleModelChange(agentKey: string, model: Model) {
    await setAgentModelBinding(projectId, agentKey, model.id);
    queryClient.invalidateQueries({ queryKey: ['agent-binding', projectId, agentKey] });
  }

  // As proporções são as do handoff (seção 7, item 6): `1.4fr 1.9fr .8fr 1.4fr
  // .9fr`. Estavam próximas, não iguais, e a diferença aparecia na primeira
  // coluna — "Psicólogo (leve)" truncava em "Psicóo…".
  const columns: TableColumn<(typeof AGENT_LIST)[number]>[] = [
    {
      key: 'agent',
      // "Agente", e não "Agente · capacidades" como no desenho: as capacidades
      // exigidas por agente não existem no domínio, e prometer uma coluna que
      // não tem conteúdo é pior que não prometer.
      label: 'Agente',
      width: '1.4fr',
      render: (agent) => (
        <span className={styles.agentCell}>
          <span className={styles.agentAvatar} style={{ ['--agent-color' as string]: agent.color } as CSSProperties}>
            {agent.initials}
          </span>
          {/* `title` porque a coluna ELIPSA por desenho: "QA de Performance e
              Segurança" cabe em 71px como "QA de Perf…", e sem o title o nome
              inteiro não existe em lugar nenhum da tela. */}
          <span className={styles.agentNome} title={agent.name}>
            {agent.name}
          </span>
        </span>
      ),
    },
    {
      key: 'model',
      label: 'Modelo vigente',
      width: '1.9fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        return modelsByCategory ? (
          <ModelPicker
            models={modelsByCategory}
            selectedModelId={resolved?.modelId}
            onSelect={(model) => handleModelChange(agent.key, model)}
            variant="inline"
          />
        ) : null;
      },
    },
    {
      key: 'origin',
      label: 'Origem',
      width: '0.8fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        if (!resolved) return <span className={styles.dash}>—</span>;

        // A cascata pode ter PULADO o binding mais específico (Fase 9c). Sem
        // dizer isso, o modelo do agente teria trocado sozinho e em silêncio.
        const pulado = resolved.skipped?.[0];
        return (
          <span className={styles.origem}>
            <Badge tone={ORIGIN_TONE[resolved.origin]}>{resolved.origin}</Badge>
            {pulado && (
              <Badge
                tone="warning"
                title={
                  pulado.reason === 'unavailable'
                    ? `O modelo de ${pulado.scope} sumiu do provider — a cascata caiu para ${resolved.origin}.`
                    : `O modelo de ${pulado.scope} não faz tool calling e não serve a um agente — a cascata caiu para ${resolved.origin}.`
                }
              >
                {pulado.scope} pulado
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      key: 'fallback',
      label: 'Fallback',
      width: '1.4fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const nome = fallbackDe(bindingQueries[index]?.data?.origin);
        return nome ? (
          <span className={styles.fallback}>{nome}</span>
        ) : (
          <span className={styles.dash}>—</span>
        );
      },
    },
    {
      key: 'estimate',
      label: 'Est. mês',
      width: '0.9fr',
      render: (agent) => {
        const micros = custoPorAgente.get(agent.key);
        // Agente que nunca rodou não vem na resposta, e traço é diferente de
        // zero: zero afirmaria um agente ativo e gratuito.
        return micros === undefined ? (
          <span className={styles.dash}>—</span>
        ) : (
          <span className={styles.estimativa}>{formatarCustoMicros(micros)}</span>
        );
      },
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Modelos por agente</h2>
        <span className={styles.eyebrow}>binding vigente por cascata</span>
      </div>
      <p className={styles.subtitle}>
        A origem indica onde o valor é resolvido:{' '}
        <span className={`${styles.nivel} ${styles.nivelWorkspace}`}>workspace</span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelProject}`}>project</span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelAgent}`}>agent</span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelAgent}`}>session</span>. O mais
        específico vence.
      </p>

      <div className={styles.custoCard}>
        <ClockIcon size={15} className={styles.custoIcone} />
        <span className={styles.custoTexto}>
          Custo estimado mensal do time{' '}
          <span className={styles.custoDetalhe}>· com base no histórico de 30 dias</span>
        </span>
        <span className={styles.custoValor}>
          {custos === undefined ? '—' : formatarCustoMicros(custoTotalMicros)}
        </span>
      </div>

      <Table columns={columns} rows={AGENT_LIST} rowKey={(a) => a.key} emptyMessage="Nenhum agente configurado." />
      {allModels.length === 0 && <div className={styles.subtitle}>Nenhum modelo disponível ainda.</div>}
    </div>
  );
}

function MembersSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: members } = useQuery({ queryKey: ['members', projectId], queryFn: () => listProjectMembers(projectId) });
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('developer');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['members', projectId] });
  }

  async function handleInvite() {
    if (!inviteUserId.trim()) return;
    try {
      await addProjectMember(projectId, { userId: inviteUserId.trim(), role: inviteRole });
      setInviteUserId('');
      invalidate();
    } catch {
      showToast({ title: 'Falha ao adicionar membro', message: 'Verifique se o ID do usuário existe', tone: 'danger' });
    }
  }

  async function handleRoleChange(userId: string, role: Role) {
    await addProjectMember(projectId, { userId, role });
    invalidate();
  }

  async function handleRemove(userId: string) {
    await removeProjectMember(projectId, userId);
    invalidate();
  }

  const columns: TableColumn<NonNullable<typeof members>[number]>[] = [
    {
      key: 'member',
      label: 'Membro',
      width: '2fr',
      render: (member) => (
        <span className={styles.membroCell}>
          <span className={styles.membroAvatar} style={gradienteDe(member.email)}>
            {iniciaisDe(member.name ?? member.email)}
          </span>
          <span className={styles.memberCell}>
            <span className={styles.memberName}>{member.name ?? member.email}</span>
            <span className={styles.memberEmail}>{member.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      label: 'Papel no projeto',
      width: '160px',
      render: (member) => (
        <Select value={member.role} onChange={(e) => handleRoleChange(member.userId, e.target.value as Role)}>
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '1fr',
      render: () => (
        <span className={styles.status}>
          <span className={styles.statusDot} />
          ativo
        </span>
      ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      render: (member) => (
        <button
          type="button"
          aria-label={`Remover ${member.name ?? member.email}`}
          title="Remover"
          className={styles.remove}
          onClick={() => handleRemove(member.userId)}
        >
          <TrashIcon size={14} />
        </button>
      ),
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Membros e papéis</h2>
        <span className={styles.eyebrow}>IAM · por projeto</span>
      </div>
      <p className={styles.subtitle}>
        Papéis definem quem pode aprovar quais ações dos agentes neste projeto.
      </p>

      <div className={styles.inviteBar}>
        <div className={styles.inviteInput}>
          <Input mono placeholder="ID do usuário (UUID)" value={inviteUserId} onChange={(e) => setInviteUserId(e.target.value)} />
        </div>
        <div className={styles.inviteRole}>
          <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={handleInvite}>Convidar</Button>
      </div>

      <Table columns={columns} rows={members ?? []} rowKey={(m) => m.userId} emptyMessage="Nenhum membro além do dono do projeto." />
    </div>
  );
}

/**
 * Repositório do projeto e, quando ele foi ADOTADO, as divergências que
 * o plano registrou (Fase 12a).
 *
 * Fica em Configurações, não na Visão geral: aquela é a superfície viva
 * (time de agentes, execução, feed de atividade em polling), e um
 * diagnóstico estático e não-bloqueante ali competiria com o que muda. É
 * aqui que fatos de repositório e credencial já moram, e é para cá que o
 * maintainer vem quando decide agir.
 */
function RepositorySection({ projectId }: { projectId: string }) {
  const { data: repository } = useQuery({
    queryKey: ['repository', projectId],
    queryFn: () => getRepository(projectId),
  });
  const { data: planoEstado } = useQuery({
    queryKey: ['bootstrap-plan', projectId],
    queryFn: () => getBootstrapPlan(projectId),
    enabled: repository?.origin === 'adopted',
  });

  if (!repository) return null;

  const avisos = planoEstado?.plan ? divergencias(planoEstado.plan) : [];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Repositório</h2>
        <span className={styles.eyebrow}>git · provider e política</span>
      </div>
      <div className={styles.subtitle}>
        {repository.origin === 'adopted'
          ? 'Adotado — já existia antes do projeto, e a política de branches é dele.'
          : 'Criado pelo Brabo, com o bootstrap de Gitflow aplicado.'}
      </div>

      {/* Faixa do repositório como no handoff (seção 7, item 1): ícone, caminho
          em mono e a origem/branch ao lado, dentro de um card — não três nós
          soltos sobre o fundo da aba. O selo "sincronizado" do desenho NÃO
          entra: não existe fato de sincronismo no `repository`, e um selo teal
          fixo afirmaria algo que ninguém mediu. */}
      <div className={styles.repoCard}>
        <BranchIcon size={16} className={styles.repoIcone} />
        <code className={styles.repoPath}>{repository.externalId}</code>
        <span className={styles.repoMeta}>
          {repository.provider} · {repository.defaultBranch}
        </span>
      </div>

      {planoEstado?.decision === 'as_is' && (
        <Alert tone="accent">
          O bootstrap foi <strong>dispensado</strong> na adoção: nenhuma branch
          ou proteção foi alterada por nós.
        </Alert>
      )}

      {avisos.length > 0 && (
        <Alert tone="accent">
          <div>Este repositório diverge do template:</div>
          <ul>
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

const DEFAULT_MAX_CONSECUTIVE_BLOCKED = 3;

/**
 * Teto do circuit breaker por dev agent (Fase 12b — RN-047): quantas tasks
 * consecutivas terminando `blocked` param o agente do módulo em
 * `idle_tripped`, em vez de continuar reivindicando trabalho.
 *
 * Primeiro campo numérico da aba — sem botão de "voltar ao default": o
 * default É o valor mostrado quando o projeto ainda não tem um próprio
 * (`null` na api), então digitar por cima e salvar já cobre os dois casos.
 */
export function ExecutionSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const valorAtual = project?.maxConsecutiveBlocked ?? DEFAULT_MAX_CONSECUTIVE_BLOCKED;
  const valorExibido = draft ?? String(valorAtual);
  const numero = Number(valorExibido);
  const valido = Number.isInteger(numero) && numero > 0;

  async function handleSave() {
    if (!valido) return;
    setSaving(true);
    try {
      await updateProject(projectId, { maxConsecutiveBlocked: numero });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setDraft(null);
      showToast({ title: 'Teto do circuit breaker salvo', tone: 'success' });
    } catch {
      showToast({ title: 'Não foi possível salvar', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Execução</h2>
        <span className={styles.eyebrow}>circuit breaker do dev agent</span>
      </div>
      <div className={styles.subtitle}>
        Circuit breaker dos dev agents — vale a partir da próxima ativação da
        execução, não afeta agentes já rodando.
      </div>

      <div className={styles.ajusteCard}>
        <div className={styles.ajusteInfo}>
          <div className={styles.ajusteTitulo}>
            Tasks blocked seguidas até parar
          </div>
          <div className={styles.ajusteHint}>
            {project.maxConsecutiveBlocked === null
              ? `Sem valor próprio — usa o default (${DEFAULT_MAX_CONSECUTIVE_BLOCKED})`
              : 'Configurado para este projeto'}
          </div>
        </div>
        <div className={styles.ajusteNumero}>
          <Input
            mono
            type="number"
            min={1}
            value={valorExibido}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button onClick={handleSave} disabled={!valido || saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}

/**
 * O teto de paralelismo de cada lead (FASE 14d — RN-083, ADR 0053).
 *
 * Uma linha por ÁREA, e não um número único do projeto: o trabalho de dev e o
 * de QA têm custos e formatos diferentes, e foi por isso que o ADR pôs o teto
 * na área. Tem botão de salvar, ao contrário do seletor de promoção logo
 * abaixo — é um número digitado, e salvar a cada tecla mandaria `1` a caminho
 * de `12`.
 *
 * Vazio para projeto que nunca ativou execução, e a tela DIZ isso em vez de
 * sumir: seção que desaparece parece bug, e o motivo (as áreas nascem do
 * `module_map`) não é adivinhável.
 */
export function ParallelismSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: areas } = useQuery({
    queryKey: ['agent-areas', projectId],
    queryFn: () => listAgentAreas(projectId),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  async function handleSave(key: string, valor: number) {
    setSaving(key);
    try {
      await setAreaMaxParallel(projectId, key, valor);
      await queryClient.invalidateQueries({
        queryKey: ['agent-areas', projectId],
      });
      setDrafts((d) => {
        const { [key]: _, ...resto } = d;
        return resto;
      });
      showToast({ title: `Teto da área ${key} salvo`, tone: 'success' });
    } catch (erro) {
      showToast({ title: mensagemDaApi(erro, 'Não foi possível salvar'), tone: 'danger' });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Paralelismo por área</h2>
        <span className={styles.eyebrow}>quantos agentes sem perguntar</span>
      </div>
      <div className={styles.subtitle}>
        Quantos agentes o lead de cada área pode ter <strong>na sessão</strong>{' '}
        sem pedir sua autorização. Acima do teto ele não sobe nada: o pedido
        vira uma ação em Aprovações, com o motivo, e espera você. O teto é da
        sessão inteira e não de cada módulo — contar por módulo deixaria muitos
        agentes subirem sem autorização nenhuma.
      </div>

      {!areas || areas.length === 0 ? (
        <div className={styles.subtitle}>
          Nenhuma área ainda. Elas nascem quando você ativa a execução, porque
          os membros da área de dev vêm do <code>module_map</code> do Arquiteto.
        </div>
      ) : (
        areas.map((area) => {
          const exibido = drafts[area.key] ?? String(area.maxParallel);
          const numero = Number(exibido);
          const valido = Number.isInteger(numero) && numero >= 1;

          return (
            <div key={area.key} className={styles.ajusteCard}>
              <div className={styles.ajusteInfo}>
                <div className={styles.ajusteTitulo}>Área {area.key}</div>
                <div className={styles.ajusteHint}>
                  Lead: {area.leadAgentId}
                  {area.members.length > 0
                    ? ` — ${area.members.length} membro(s)`
                    : ' — sem membros ainda'}
                </div>
              </div>
              <div className={styles.ajusteNumero}>
                <Input
                  mono
                  type="number"
                  min={1}
                  aria-label={`Teto de agentes da área ${area.key}`}
                  value={exibido}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [area.key]: e.target.value }))
                  }
                />
              </div>
              <Button
                onClick={() => handleSave(area.key, numero)}
                disabled={!valido || saving === area.key}
              >
                {saving === area.key ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Quem promove história a `ready` (Fase 12c — RN-048).
 *
 * Salva no `onChange`, sem botão, como o seletor de papel em `MembersSection`:
 * é uma escolha entre dois valores nomeados, não um campo digitado que precise
 * de confirmação.
 */
export function PromotionSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const [saving, setSaving] = useState(false);

  async function handleChange(modo: StoryPromotionMode) {
    setSaving(true);
    try {
      await updateProject(projectId, { storyPromotion: modo });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      showToast({
        title:
          modo === 'manual'
            ? 'Promoção manual: você decide o que fica pronto'
            : 'Promoção automática: o PO promove sozinho',
        tone: 'success',
      });
    } catch {
      showToast({ title: 'Não foi possível salvar', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Promoção de histórias</h2>
        <span className={styles.eyebrow}>quem dá o passo</span>
      </div>
      <div className={styles.subtitle}>
        Uma história só vira trabalho pegável quando está <em>pronta</em>. Isto
        define quem dá esse passo. As validações são as MESMAS nos dois modos —
        o que muda é quem dispara, nunca o que é exigido. Vale para as próximas
        histórias; as que já estão propostas continuam esperando você.
      </div>

      <div className={styles.ajusteCard}>
        <div className={styles.ajusteInfo}>
          <div className={styles.ajusteTitulo}>Quem promove</div>
          <div className={styles.ajusteHint}>
            {project.storyPromotion === 'manual'
              ? 'O PO deixa a história completa e ela aguarda você no Backlog. Nenhuma tarefa dela é pegável até lá.'
              : 'O PO promove sozinho ao terminar uma história completa — era o comportamento anterior à Fase 12c, mantido como opção.'}
          </div>
        </div>
        <div className={styles.ajusteControle}>
          <Select
            value={project.storyPromotion}
            disabled={saving}
            aria-label="Quem promove histórias"
            onChange={(e) =>
              handleChange(e.target.value as StoryPromotionMode)
            }
          >
            <option value="manual">Manual — eu promovo</option>
            <option value="auto">Automática — o PO promove</option>
          </Select>
        </div>
      </div>
    </div>
  );
}

function MatrixSection() {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Quem pode aprovar o quê</h2>
        <span className={styles.eyebrow}>matriz resumida</span>
      </div>
      <p className={styles.subtitle}>
        Tabela informativa — reflete os papéis mínimos por tipo de ação hoje aplicados no backend; algumas linhas ainda não têm checagem
        granular própria e usam a aproximação mais próxima.
      </p>
      <div className={styles.matrixWrap}>
        <table className={styles.matrixTable}>
          <thead>
            <tr>
              <th>Ação</th>
              <th>owner</th>
              <th>maintainer</th>
              <th>developer</th>
              <th>viewer</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {(['owner', 'maintainer', 'developer', 'viewer'] as Role[]).map((role) => (
                  <td key={role}>
                    {ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(row.minRole) ? (
                      <span className={styles.check}>✓</span>
                    ) : (
                      <span className={styles.dash}>—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* A legenda do desenho: sem ela, ✓ e — são dois símbolos sem contrato. */}
      <div className={styles.matrixLegenda}>
        <span className={styles.matrixLegendaItem}>
          <span className={styles.check}>✓</span> pode aprovar
        </span>
        <span className={styles.matrixLegendaItem}>
          <span className={styles.dash}>—</span> sem permissão
        </span>
      </div>
    </div>
  );
}

// Exportada para o teste, como ExecutionSection e PromotionSection.
export function CredentialsSection() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: credentials } = useQuery({ queryKey: ['credentials'], queryFn: listCredentials });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Qual provider está com uma chamada em voo — `null` quando nenhum. Um id
  // só, e não um booleano por card: duas chamadas simultâneas aqui não fazem
  // sentido nenhum, e o estado por provider convidaria a esquecer de limpá-lo.
  const [emVoo, setEmVoo] = useState<string | null>(null);

  /**
   * Todo `catch` desta seção existe por um bug real: sem eles, o `ApiError`
   * escapava do `onClick` e caía no `unhandledrejection` global, que só LOGA.
   * O sintoma era o pior possível — o botão Salvar parecia não ter ação,
   * enquanto a api respondia 422 a cada clique.
   */
  async function handleSave(provider: LlmCredentialProvider) {
    const apiKey = drafts[provider]?.trim();
    if (!apiKey) return;
    setEmVoo(provider);
    try {
      await upsertCredential({ provider, apiKey });
      setDrafts((d) => ({ ...d, [provider]: '' }));
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      showToast({ title: 'Credencial salva', tone: 'success' });
    } catch (erro) {
      showToast({
        title: 'Não deu para salvar',
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setEmVoo(null);
    }
  }

  /**
   * A verificação que saiu do cadastro (ADR 0050). Os três resultados viram
   * três toasts diferentes de propósito: `nao_suportado` NÃO pode parecer
   * sucesso, senão a tela afirma que uma chave foi checada quando ninguém a
   * checou.
   */
  async function handleTest(provider: LlmCredentialProvider) {
    setEmVoo(provider);
    try {
      const { resultado, motivo } = await testCredential(provider);
      if (resultado === 'ok') {
        showToast({ title: 'O provider aceitou a chave', tone: 'success' });
      } else if (resultado === 'recusado') {
        showToast({ title: 'O provider recusou a chave', message: motivo, tone: 'danger' });
      } else {
        showToast({
          title: 'Sem verificação para este provider',
          message: 'A chave continua salva — este provider não tem endpoint de teste.',
          tone: 'warning',
        });
      }
    } catch (erro) {
      showToast({ title: 'Não deu para testar', message: mensagemDaApi(erro), tone: 'danger' });
    } finally {
      setEmVoo(null);
    }
  }

  async function handleRemove(provider: LlmCredentialProvider) {
    setEmVoo(provider);
    try {
      await deleteCredential(provider);
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      showToast({ title: 'Credencial removida', tone: 'success' });
    } catch (erro) {
      showToast({
        title: 'Não deu para remover',
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setEmVoo(null);
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Credenciais de provider</h2>
        <span className={styles.eyebrow}>write-only · por usuário</span>
      </div>
      <div className={styles.subtitle}>
        Chaves write-only — nunca reexibidas após salvas. Como não há como
        conferir o que está guardado, o que se oferece é <strong>trocar</strong>{' '}
        e <strong>testar</strong>: o teste roda no servidor sobre a chave
        cifrada e devolve só o veredito.
      </div>

      {/* Grid de conectores do handoff (seção 7, item 4): um card por
          provider, borda esquerda na cor dele, sigla de duas letras, tipo em
          mono e ponto de status pulsante. Era uma pilha de nove faixas de
          largura total, e o desenho pede
          `repeat(auto-fill, minmax(300px, 1fr))`. */}
      <div className={styles.conectorGrid}>
        {CREDENCIAIS_DE_LLM.map(({ id, label, kind }) => {
          const existing = credentials?.find((c) => c.provider === id);
          const rascunho = drafts[id]?.trim() ?? '';
          const ocupado = emVoo === id;
          const cor = COR_DO_CONECTOR[id];
          return (
            <div
              key={id}
              className={styles.conectorCard}
              style={{ ['--conector-cor' as string]: cor } as CSSProperties}
            >
              <div className={styles.conectorTopo}>
                <span className={styles.conectorSigla}>{siglaDoConector(label)}</span>
                <div className={styles.conectorIdent}>
                  <div className={styles.conectorNome}>{label}</div>
                  <div className={styles.conectorTipo}>
                    {/* Um hub roteia para provedores de terceiros: o custo e a
                        disponibilidade dependem de quem serve por baixo. */}
                    {kind === 'hub' ? 'hub de providers' : 'credencial de provider'}
                  </div>
                </div>
                <span
                  className={[styles.conectorStatus, existing && styles.conectorAtivo]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className={styles.conectorPonto} />
                  {existing ? 'configurada' : 'sem chave'}
                </span>
              </div>

              {/* O desenho mostra a chave mascarada. Aqui ela NÃO existe: a
                  credencial é write-only e nunca volta do servidor (ADR 0050).
                  Mostrar `sk-••••` seria inventar um prefixo que ninguém leu. */}
              <div className={styles.conectorNota}>
                {existing
                  ? `Configurada em ${new Date(existing.updatedAt).toLocaleDateString('pt-BR')} · nunca reexibida`
                  : 'Nenhuma credencial salva'}
              </div>

              {/* O input fica SEMPRE visível: com credencial salva ele é o
                  caminho da troca, que antes só existia removendo primeiro. */}
              <Input
                mono
                type="password"
                aria-label={existing ? `Nova chave de ${label}` : `API key de ${label}`}
                placeholder={existing ? 'Trocar chave' : 'API key'}
                value={drafts[id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
              />

              <div className={styles.conectorAcoes}>
                {/* Nome acessível com o provider: são oito cards com botões de
                    texto idêntico, e "Salvar" sozinho não diz salvar o quê. */}
                <Button
                  aria-label={`${existing ? 'Trocar' : 'Salvar'} chave de ${label}`}
                  disabled={ocupado || rascunho.length === 0}
                  onClick={() => handleSave(id)}
                >
                  {existing ? 'Trocar' : 'Salvar'}
                </Button>
                {existing && (
                  <>
                    <Button
                      variant="secondary"
                      aria-label={`Testar chave de ${label}`}
                      disabled={ocupado}
                      onClick={() => handleTest(id)}
                    >
                      Testar
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={`Remover chave de ${label}`}
                      disabled={ocupado}
                      onClick={() => handleRemove(id)}
                    >
                      Remover
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Perfil de proficiência (Fase 4b — Anamnese): competência, nível e "os
 * porquês" com evidências clicáveis que navegam até o evento na sessão.
 * O usuário pode apagar o PRÓPRIO perfil — o que também registra o
 * opt-out (senão a rodada seguinte re-derivaria tudo).
 */
function ProficiencySection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: profiles } = useProficiency(projectId);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [emVoo, setEmVoo] = useState(false);

  const all = profiles ?? [];
  const byUser = new Map<string, typeof all>();
  for (const p of all) {
    byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  }

  async function handleDelete() {
    setConfirmandoDelete(false);
    setEmVoo(true);
    try {
      await deleteMyProficiency(projectId);
      await queryClient.invalidateQueries({ queryKey: ['proficiency', projectId] });
      showToast({
        title: 'Perfil apagado',
        message: 'A Anamnese não vai mais te perfilar até você reativar.',
        tone: 'success',
      });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível apagar o perfil', tone: 'danger' });
    } finally {
      setEmVoo(false);
    }
  }

  async function handleOptIn() {
    setEmVoo(true);
    try {
      await optInProficiency(projectId);
      // Sem invalidar, a lista só voltava a aparecer no poll seguinte.
      await queryClient.invalidateQueries({ queryKey: ['proficiency', projectId] });
      showToast({ title: 'Reativado', message: 'A Anamnese voltará a perfilar você.', tone: 'success' });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível reativar', tone: 'danger' });
    } finally {
      setEmVoo(false);
    }
  }

  async function handleRunNow() {
    setEmVoo(true);
    try {
      await runAnamnese(projectId);
      showToast({
        title: 'Rodada enfileirada',
        message: 'A Anamnese vai analisar a janela agora.',
        tone: 'success',
      });
    } catch {
      showToast({
        title: 'Erro',
        message: 'Não foi possível enfileirar a rodada',
        tone: 'danger',
      });
    } finally {
      setEmVoo(false);
    }
  }

  // A janela da Anamnese é de PROJETO e atravessa várias sessões, então a
  // sessão do evento precisa ser RESOLVIDA — usar a sessão mais recente caía
  // em "evento não encontrado nesta sessão" para toda evidência antiga.
  async function goToEvidence(eventId: string) {
    try {
      const event = await getProjectEvent(projectId, eventId);
      navigate({
        to: '/projects/$projectId/sessions/$sessionId',
        params: { projectId, sessionId: event.sessionId },
        search: { highlightEvent: eventId },
      });
    } catch {
      showToast({
        title: 'Evidência indisponível',
        message: 'O evento citado não foi encontrado neste projeto.',
        tone: 'danger',
      });
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Perfil de proficiência</h2>
        <span className={styles.eyebrow}>anamnese · derivado</span>
      </div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        Derivado pela Anamnese a partir das suas interações. Só competências
        técnicas e de processo — nunca características pessoais.
      </div>

      {all.length === 0 ? (
        <div className={styles.subtitle}>
          Nada ainda — a Anamnese roda periodicamente sobre o log do projeto.
        </div>
      ) : (
        [...byUser.entries()].map(([userId, group]) => (
          <div key={userId} className={styles.profileGroup}>
            <div className={styles.profileUser}>{identidadeDe(group)}</div>
            {group.map((profile) => (
              <div key={profile.id}>
                <div className={styles.profileRow}>
                  <span className={styles.profileCompetency}>
                    {profile.competency}
                  </span>
                  <Badge tone={LEVEL_TONE[profile.level] ?? 'muted'}>
                    {profile.level}
                  </Badge>
                  <span className={styles.profileWhy}>{profile.rationale}</span>
                </div>
                <div className={styles.evidenceChips}>
                  {profile.evidenceEventIds.map((eventId) => (
                    <button
                      key={eventId}
                      type="button"
                      className={styles.evidenceChip}
                      onClick={() => goToEvidence(eventId)}
                    >
                      {eventId.slice(-8)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button
          variant="danger"
          disabled={emVoo}
          onClick={() => setConfirmandoDelete(true)}
        >
          Apagar meu perfil
        </Button>
        <Button variant="ghost" disabled={emVoo} onClick={handleOptIn}>
          Voltar a ser perfilado
        </Button>
        <Button variant="secondary" disabled={emVoo} onClick={handleRunNow}>
          Rodar agora
        </Button>
      </div>

      {/* Apagar é irreversível (e grava opt-out) — um clique cru era demais
          para uma ação que não tem como desfazer o que foi apagado. */}
      {confirmandoDelete && (
        <Modal
          title="Apagar meu perfil de proficiência?"
          onClose={() => setConfirmandoDelete(false)}
        >
          <div className={styles.subtitle}>
            As linhas do seu perfil são apagadas de verdade, e a Anamnese para
            de te perfilar até você reativar. O que já foi apagado não volta.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="danger" onClick={handleDelete}>
              Apagar
            </Button>
            <Button variant="ghost" onClick={() => setConfirmandoDelete(false)}>
              Cancelar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Histórico de versões por arquivo de agente (Fase 4b), com diff de cada
 * versão contra a anterior e rollback de um clique. Rollback é operação
 * PRA FRENTE: grava uma versão nova com o conteúdo antigo.
 */
function InstructionVersionsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Pergunta ao backend QUEM tem histórico, em vez de adivinhar pelo roster
  // estático: os dev agents são instanciados por módulo (`dev-api`), não
  // existem em AGENT_LIST, e eram justamente os invisíveis aqui.
  const { data: historico } = useQuery({
    queryKey: ['instruction-versions', projectId],
    queryFn: () => listProjectInstructionVersions(projectId),
    refetchInterval: pollQueParaNoErro(15000),
  });

  // Um clique é o que o enunciado pede — mas revertendo DUAS vezes por duplo
  // clique nascem duas versões. `revertendo` desabilita enquanto voa.
  const [revertendo, setRevertendo] = useState<string | null>(null);

  async function handleRollback(agent: string, version: number) {
    setRevertendo(`${agent}:${version}`);
    try {
      await rollbackInstruction(projectId, agent, version);
      await queryClient.invalidateQueries({
        queryKey: ['instruction-versions', projectId],
      });
      showToast({
        title: 'Revertido',
        message: `${agent} voltou ao conteúdo da v${version}.`,
        tone: 'success',
      });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível reverter', tone: 'danger' });
    } finally {
      setRevertendo(null);
    }
  }

  const withHistory = (historico ?? []).map((entry) => ({
    // `label` do roster quando o slug é conhecido; senão o próprio slug
    // (`dev-api` e afins não estão no roster e não podem virar "undefined").
    agent: {
      key: entry.agent,
      label: AGENT_LIST.find((a) => a.key === entry.agent)?.name ?? entry.agent,
    },
    versions: entry.versions,
  }));

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>Histórico de instruções</h2>
        <span className={styles.eyebrow}>versionamento por agente</span>
      </div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        Cada patch aprovado vira uma versão. Reverter grava uma versão nova
        com o conteúdo antigo — nada é apagado.
      </div>

      {withHistory.length === 0 ? (
        <div className={styles.subtitle}>
          Nenhum agente teve a instrução alterada ainda.
        </div>
      ) : (
        withHistory.map(({ agent, versions }) => (
          <div key={agent.key} className={styles.agentBlock}>
            <div className={styles.profileUser}>{agent.label}</div>
            {versions.map((version) => {
              const key = `${agent.key}:${version.version}`;
              const open = expanded === key;
              return (
                <div key={version.id}>
                  <div className={styles.versionRow}>
                    <span className={styles.versionNo}>v{version.version}</span>
                    {version.isCurrent && <Badge tone="success">atual</Badge>}
                    {version.sourceHypothesisId && (
                      <Badge tone="accent">
                        hipótese {version.sourceHypothesisId.slice(-8)}
                      </Badge>
                    )}
                    <span className={styles.versionNote}>
                      {version.note ?? '—'}
                    </span>
                    <button
                      type="button"
                      className={styles.evidenceChip}
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      {open ? 'ocultar diff' : `diff +${version.diff.additions} −${version.diff.deletions}`}
                    </button>
                    {!version.isCurrent && (
                      <Button
                        variant="secondary"
                        disabled={revertendo !== null}
                        onClick={() => handleRollback(agent.key, version.version)}
                      >
                        {revertendo === `${agent.key}:${version.version}`
                          ? 'Revertendo…'
                          : 'Reverter'}
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div className={styles.versionDiff}>
                      {version.diff.lines.map((line, i) => (
                        <div
                          key={i}
                          className={[
                            styles.diffLine,
                            line.kind === 'add' && styles.add,
                            line.kind === 'del' && styles.del,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className={styles.diffSign}>
                            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                          </span>
                          <span>{line.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

// E-mail é como o resto do app identifica pessoa; o `userId` é UUID e ninguém
// se reconhece nele. Fallback pro nome e, em último caso, pro id — o perfil
// sobrevive à remoção do membro, e aí não há e-mail pra mostrar.
function identidadeDe(group: ProficiencyProfile[]): string {
  const primeiro = group[0];
  return primeiro?.userEmail ?? primeiro?.userName ?? primeiro?.userId ?? '—';
}


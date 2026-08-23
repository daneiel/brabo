import { useState, type CSSProperties } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  addProjectMember,
  ApiError,
  deleteMyProficiency,
  getProject,
  getProjectEvent,
  listProjectInstructionVersions,
  optInProficiency,
  runAnamnese,
  rollbackInstruction,
  deleteCredential,
  clearAgentModelBinding,
  clearAreaModelBinding,
  getAgentModelBinding,
  getAreaModelBinding,
  getBootstrapPlan,
  getProjectAgentCosts,
  getProjectModelBinding,
  getRepository,
  getWorkspaceModelBinding,
  listCredentials,
  listModels,
  listModelCatalog,
  listAgentAreas,
  listProjectMembers,
  removeProjectMember,
  listPersonalAccessTokens,
  issuePersonalAccessToken,
  revokePersonalAccessToken,
  listAllPersonalAccessTokens,
  revokePersonalAccessTokenAsMaintainer,
  mensagemDaApi,
  setAgentModelBinding,
  setAreaModelBinding,
  setAreaMaxParallel,
  setAreaBudget,
  testCredential,
  updateProject,
  upsertCredential,
} from '../lib/api-client';
import { AGENT_LIST, AREAS, areaFor } from '../lib/agents';
import { useProficiency } from '../lib/hooks';
import { pollQueParaNoErro } from '../lib/query-policy';
import { ROLE_LABEL, ROLE_ORDER } from '../lib/roles';
import type {
  AgentArea,
  Model,
  ModelBindingScope,
  ModelComCuradoria,
  PersonalAccessTokenIssued,
  PersonalAccessTokenSummary,
  PersonalAccessTokenAdminSummary,
  ResolvedBinding,
  ProficiencyLevel,
  ProficiencyProfile,
  Role,
  StoryPromotionMode,
  UsoDeModelo,
} from '../lib/api-types';
import {
  CREDENCIAIS_DE_LLM,
  formatarPreco,
  ROTULO_DO_USO,
  USOS_DE_MODELO,
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
  area: 'accent',
  agent: 'success',
  session: 'success',
};

/**
 * Cor de cada uso na tabela de "melhores modelos por capacidade" — só
 * distinção visual entre chips, como `ORIGIN_TONE`/`LEVEL_TONE` já fazem para
 * outros enums neste arquivo. Não é capability nem curadoria; é mapeamento
 * cosmético 1:1 sobre os cinco tons que `Badge` tem.
 */
const USO_TONE: Record<UsoDeModelo, BadgeTone> = {
  codigo: 'accent',
  documentacao: 'warning',
  analise: 'danger',
  imagem: 'success',
  conversa: 'muted',
};

// `key` resolve para `matrix.rows.<key>` — a tradução é resolvida por quem
// consome (`MatrixSection`), como o padrão pede para dado não-React.
const MATRIX_ROWS: { key: string; minRole: Role }[] = [
  { key: 'mergeOpenPr', minRole: 'maintainer' },
  { key: 'deployProduction', minRole: 'maintainer' },
  { key: 'privilegedCommand', minRole: 'developer' },
  { key: 'schemaMigration', minRole: 'developer' },
  { key: 'editPermissions', minRole: 'maintainer' },
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
function siglaDoConector(label: string): string {
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
      <BudgetSection projectId={projectId} />
      <PromotionSection projectId={projectId} />
      <MelhoresModelosPorCapacidadeSection projectId={projectId} />
      <ModelsSection projectId={projectId} />
      <AreaModelsSection projectId={projectId} />
      <CatalogoDeModelos projectId={projectId} />
      <MembersSection projectId={projectId} />
      <PersonalAccessTokensSection projectId={projectId} />
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
 * "Melhores modelos por capacidade" (handoff, Configurações item 5).
 *
 * O handoff mostra uma NOTA por capacidade (código 9.4, imagem 9.1…) —
 * `design_handoff_brabo/README.md`, "Ranking por capacidade". É dado
 * FICTÍCIO do mock: nenhum provider publica "qualidade de código" e o
 * produto não mede isso em lugar nenhum. Calcular um número aqui seria o
 * mesmo "palpite vestido de dado" que o ADR 0041 proíbe para capability de
 * MODELO, agora sobre qualidade — e por isso esta tabela não tem coluna de
 * nota. O que ela mostra são dois sinais REAIS:
 *
 * - **Recomendado/alternativa**: entre os modelos que a curadoria DESTE
 *   workspace marcou para aquele uso (`uses`, ADR 0051 — nunca calculado,
 *   sempre marcado à mão no catálogo abaixo), o mais usado pelos agentes
 *   deste projeto primeiro, custo como desempate. Uso sem modelo curado
 *   mostra "sem cobertura curada" — nunca esconde a linha.
 * - **Usado por**: contagem real de agentes DESTE projeto cujo binding
 *   vigente (mesma cascata da tabela abaixo) resolve para aquele modelo.
 *
 * A curadoria pende de `:workspaceId` e exige `maintainer` (ADR 0042) — esta
 * seção herda a mesma visibilidade de `CatalogoDeModelos`, mais abaixo, e não
 * é mostrada a quem só tem `viewer`/`developer`. Ver ADR 0077.
 */
export function MelhoresModelosPorCapacidadeSection({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation('settings');
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const { data: catalogo } = useQuery({
    queryKey: ['model-catalog', project?.workspaceId],
    queryFn: () => listModelCatalog(project!.workspaceId),
    enabled: Boolean(project?.workspaceId),
  });
  // MESMA queryKey que `ModelsSection` usa para o binding de cada agente —
  // o react-query deduplica, então as duas seções montadas juntas custam UMA
  // rodada de requisições, não duas.
  const bindingQueries = useQueries({
    queries: AGENT_LIST.map((agent) => ({
      queryKey: ['agent-binding', projectId, agent.key],
      queryFn: () => getAgentModelBinding(projectId, agent.key),
    })),
  });

  if (!catalogo) return null;

  const todosOsModelos: ModelComCuradoria[] = [
    ...Object.values(catalogo.local).flat(),
    ...Object.values(catalogo.cloud).flat(),
  ];

  const usadoPorContagem = new Map<string, number>();
  for (const query of bindingQueries) {
    const modelId = query.data?.modelId;
    if (modelId) {
      usadoPorContagem.set(modelId, (usadoPorContagem.get(modelId) ?? 0) + 1);
    }
  }

  interface LinhaDeRanking {
    uso: UsoDeModelo;
    recomendado: ModelComCuradoria | undefined;
    alternativa: ModelComCuradoria | undefined;
  }

  const linhas: LinhaDeRanking[] = USOS_DE_MODELO.map((uso) => {
    const candidatos = todosOsModelos
      .filter((m) => m.isActive && m.uses.includes(uso))
      .sort((a, b) => {
        const usoA = usadoPorContagem.get(a.id) ?? 0;
        const usoB = usadoPorContagem.get(b.id) ?? 0;
        // Mais usado pelo TIME primeiro — o sinal mais honesto que existe de
        // "serve bem" sem inventar nota; custo desempata, do mais barato ao
        // mais caro (grátis/local vence naturalmente).
        return (
          usoB - usoA ||
          a.inputPricePerMillionMicros - b.inputPricePerMillionMicros
        );
      });
    return { uso, recomendado: candidatos[0], alternativa: candidatos[1] };
  });

  const columns: TableColumn<LinhaDeRanking>[] = [
    {
      key: 'capacidade',
      label: t('bestModels.columns.capability'),
      width: '1.15fr',
      render: (linha) => (
        <Badge tone={USO_TONE[linha.uso]}>{ROTULO_DO_USO[linha.uso]}</Badge>
      ),
    },
    {
      key: 'recomendado',
      label: t('bestModels.columns.recommended'),
      width: '1.5fr',
      render: (linha) =>
        linha.recomendado ? (
          <span className={styles.rankModelo}>
            <span className={styles.rankNome} title={linha.recomendado.displayName}>
              {linha.recomendado.displayName}
            </span>
            <span className={styles.rankDetalhe}>{formatarPreco(linha.recomendado)}</span>
          </span>
        ) : (
          <span className={styles.dash}>{t('bestModels.noCuratedCoverage')}</span>
        ),
    },
    {
      key: 'alternativa',
      label: t('bestModels.columns.alternative'),
      width: '1.35fr',
      render: (linha) =>
        linha.alternativa ? (
          <span className={styles.rankModelo}>
            <span className={styles.rankNome} title={linha.alternativa.displayName}>
              {linha.alternativa.displayName}
            </span>
            <span className={styles.rankDetalhe}>{formatarPreco(linha.alternativa)}</span>
          </span>
        ) : (
          <span className={styles.dash}>—</span>
        ),
    },
    {
      key: 'usadoPor',
      label: t('bestModels.columns.usedBy'),
      width: '1.5fr',
      render: (linha) => {
        const n = linha.recomendado
          ? usadoPorContagem.get(linha.recomendado.id) ?? 0
          : 0;
        return n > 0 ? (
          <span className={styles.fallback}>
            {t('bestModels.usedByCount', { count: n })}
          </span>
        ) : (
          <span className={styles.dash}>{t('bestModels.noAgentYet')}</span>
        );
      },
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('bestModels.title')}</h2>
        <span className={styles.eyebrow}>{t('bestModels.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {t('bestModels.subtitle.before')}
        <em>{t('bestModels.subtitle.link')}</em>
        {t('bestModels.subtitle.after')}
      </p>
      <Table
        columns={columns}
        rows={linhas}
        rowKey={(l) => l.uso}
        emptyMessage={t('bestModels.emptyMessage')}
      />
    </div>
  );
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
  const { t } = useTranslation('settings');
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

  // O padrão de cada ÁREA (ADR 0064, RN-102) — uma busca por área, não por
  // agente: lead e subagentes de uma mesma área compartilham a mesma pergunta.
  const areaKeys = Object.keys(AREAS);
  const areaBindingQueries = useQueries({
    queries: areaKeys.map((key) => ({
      queryKey: ['area-binding', projectId, key],
      queryFn: () => getAreaModelBinding(projectId, key),
    })),
  });
  const bindingDaAreaPorChave = new Map(
    areaKeys.map((key, index) => [key, areaBindingQueries[index]?.data]),
  );

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
   * `session > agent > area > project > workspace`
   * (`domain/llm/binding-resolver.ts`), então o fallback é o binding do nível
   * imediatamente inferior à origem resolvida. Origem `workspace` já é o
   * último nível: não há para onde cair.
   *
   * `area` entrou na FASE 23 (ADR 0064) ENTRE agente e projeto, e por isso
   * precisa do AGENTE da linha — áreas diferentes têm padrões diferentes, ao
   * contrário de projeto e workspace, que valem para a tabela inteira.
   */
  function fallbackDe(
    agentKey: string,
    origin: ResolvedBinding['origin'] | undefined,
  ) {
    const areaDoAgente = areaFor(agentKey);
    const bindingDaArea = areaDoAgente
      ? bindingDaAreaPorChave.get(areaDoAgente.key)
      : undefined;

    if (origin === 'session' || origin === 'agent') {
      return (
        nomeDoModelo(bindingDaArea?.modelId) ??
        nomeDoModelo(bindingDoProjeto?.modelId) ??
        nomeDoModelo(bindingDoWorkspace?.modelId)
      );
    }
    if (origin === 'area') {
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

  /**
   * "Voltar a herdar" (RN-102) — APAGA o binding do agente, nunca grava nele
   * o modelo da área: gravar viraria cópia, e a próxima mudança da área
   * deixaria este agente para trás em silêncio.
   */
  async function handleClearAgentBinding(agentKey: string) {
    await clearAgentModelBinding(projectId, agentKey);
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
      label: t('modelsSection.columns.agent'),
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
      label: t('modelsSection.columns.model'),
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
      label: t('modelsSection.columns.origin'),
      width: '0.8fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        if (!resolved) return <span className={styles.dash}>—</span>;

        // A cascata pode ter PULADO o binding mais específico (Fase 9c). Sem
        // dizer isso, o modelo do agente teria trocado sozinho e em silêncio.
        const pulado = resolved.skipped?.[0];
        const areaDoAgente = areaFor(agent.key);
        // `origin === 'agent'` é o agente DIVERGINDO — de uma área, quando ele
        // tem uma, ou do projeto/workspace, quando não tem (RN-102). Nos dois
        // casos "voltar a herdar" é apagar o binding dele, e é isso que o
        // botão faz — nunca copia o modelo do nível de baixo para cá.
        const divergiu = resolved.origin === 'agent';
        return (
          <span className={styles.origem}>
            <Badge
              tone={ORIGIN_TONE[resolved.origin]}
              title={
                resolved.origin === 'area' && areaDoAgente
                  ? t('modelsSection.areaOriginTitle', { area: areaDoAgente.label })
                  : undefined
              }
            >
              {resolved.origin}
            </Badge>
            {pulado && (
              <Badge
                tone="warning"
                title={
                  pulado.reason === 'unavailable'
                    ? t('modelsSection.skippedTitleUnavailable', {
                        scope: pulado.scope,
                        origin: resolved.origin,
                      })
                    : t('modelsSection.skippedTitleNoToolCalling', {
                        scope: pulado.scope,
                        origin: resolved.origin,
                      })
                }
              >
                {t('modelsSection.skippedBadge', { scope: pulado.scope })}
              </Badge>
            )}
            {divergiu && (
              <button
                type="button"
                className={styles.voltarHerdar}
                onClick={() => handleClearAgentBinding(agent.key)}
                title={
                  areaDoAgente
                    ? t('modelsSection.backToInheritTitleWithArea', {
                        area: areaDoAgente.label,
                      })
                    : t('modelsSection.backToInheritTitleNoArea')
                }
              >
                {t('modelsSection.backToInherit')}
              </button>
            )}
          </span>
        );
      },
    },
    {
      key: 'fallback',
      label: t('modelsSection.columns.fallback'),
      width: '1.4fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const nome = fallbackDe(agent.key, bindingQueries[index]?.data?.origin);
        return nome ? (
          <span className={styles.fallback}>{nome}</span>
        ) : (
          <span className={styles.dash}>—</span>
        );
      },
    },
    {
      key: 'estimate',
      label: t('modelsSection.columns.estimate'),
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
        <h2 className={styles.title}>{t('modelsSection.title')}</h2>
        <span className={styles.eyebrow}>{t('modelsSection.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {t('modelsSection.subtitle.intro')}{' '}
        <span className={`${styles.nivel} ${styles.nivelWorkspace}`}>workspace</span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelProject}`}>project</span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelArea}`}>area</span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelAgent}`}>agent</span> →{' '}
        <span className={`${styles.nivel} ${styles.nivelAgent}`}>session</span>.{' '}
        {t('modelsSection.subtitle.mostSpecificWins')}{' '}
        <strong>{t('modelsSection.subtitle.areaWord')}</strong>{' '}
        {t('modelsSection.subtitle.areaExplain')}{' '}
        <em>{t('modelsSection.subtitle.areaLink')}</em>
        {t('modelsSection.subtitle.below')}
      </p>

      <div className={styles.custoCard}>
        <ClockIcon size={15} className={styles.custoIcone} />
        <span className={styles.custoTexto}>
          {t('modelsSection.costCard.label')}{' '}
          <span className={styles.custoDetalhe}>{t('modelsSection.costCard.detail')}</span>
        </span>
        <span className={styles.custoValor}>
          {custos === undefined ? '—' : formatarCustoMicros(custoTotalMicros)}
        </span>
      </div>

      <Table
        columns={columns}
        rows={AGENT_LIST}
        rowKey={(a) => a.key}
        emptyMessage={t('modelsSection.emptyMessage')}
      />
      {allModels.length === 0 && (
        <div className={styles.subtitle}>{t('modelsSection.noModelsAvailable')}</div>
      )}
    </div>
  );
}

/**
 * O modelo PADRÃO de cada área — o que o lead e os subagentes compartilham
 * até que um deles divirja (ADR 0064, RN-102).
 *
 * `maintainer`, e não `developer` como na linha de agente: o modelo da área
 * alcança o lead e todos os subagentes de uma vez, e escolher modelo é
 * decidir quanto o produto gasta sem perguntar — o mesmo motivo do teto de
 * paralelismo (`ParallelismSection`, RN-083).
 */
export function AreaModelsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeEditar = comPapel?.role === 'owner' || comPapel?.role === 'maintainer';

  const { data: modelsByCategory } = useQuery({
    queryKey: ['models', projectId],
    queryFn: () => listModels(projectId),
  });

  const areaKeys = Object.keys(AREAS);
  const bindingQueries = useQueries({
    queries: areaKeys.map((key) => ({
      queryKey: ['area-binding', projectId, key],
      queryFn: () => getAreaModelBinding(projectId, key),
    })),
  });

  function invalidate(areaKey: string) {
    queryClient.invalidateQueries({ queryKey: ['area-binding', projectId, areaKey] });
    // Todo agente da área pode ter herdado o valor — a coluna Origem da
    // tabela de cima também precisa reler.
    queryClient.invalidateQueries({ queryKey: ['agent-binding', projectId] });
  }

  async function handleSet(areaKey: string, model: Model) {
    try {
      await setAreaModelBinding(projectId, areaKey, model.id);
      invalidate(areaKey);
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('areaModels.toast.saveError')),
        tone: 'danger',
      });
    }
  }

  async function handleClear(areaKey: string) {
    try {
      await clearAreaModelBinding(projectId, areaKey);
      invalidate(areaKey);
      showToast({
        title: t('areaModels.toast.reverted', { area: areaKey }),
        tone: 'success',
      });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('areaModels.toast.saveError')),
        tone: 'danger',
      });
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('areaModels.title')}</h2>
        <span className={styles.eyebrow}>{t('areaModels.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {t('areaModels.subtitle.main')}
        {!podeEditar && t('areaModels.subtitle.needsMaintainer')}
      </p>

      {areaKeys.map((key, index) => {
        const area = AREAS[key];
        const resolved = bindingQueries[index]?.data;
        const divergiuDoProjeto = resolved?.origin === 'area';

        return (
          <div key={key} className={styles.ajusteCard}>
            <div className={styles.ajusteInfo}>
              <div className={styles.ajusteTitulo}>
                <span>{t('areaModels.card.title', { area: area.label })}</span>
                <Badge tone={resolved ? ORIGIN_TONE[resolved.origin] : 'muted'}>
                  {resolved?.origin ?? '—'}
                </Badge>
              </div>
              <div className={styles.ajusteHint}>
                {t('areaModels.card.lead', { lead: area.lead })}
                {area.members.length > 0
                  ? t('areaModels.card.subagents', { list: area.members.join(', ') })
                  : t('areaModels.card.subagentsDynamic')}
              </div>
            </div>

            {modelsByCategory && (
              <div className={styles.ajusteControle}>
                <ModelPicker
                  models={modelsByCategory}
                  selectedModelId={resolved?.modelId}
                  onSelect={(model) => handleSet(key, model)}
                  variant="inline"
                  disabled={!podeEditar}
                />
              </div>
            )}

            {divergiuDoProjeto && (
              <Button
                variant="ghost"
                disabled={!podeEditar}
                onClick={() => handleClear(key)}
              >
                {t('areaModels.card.backToInherit')}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MembersSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
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
      showToast({
        title: t('members.toast.inviteErrorTitle'),
        message: t('members.toast.inviteErrorMessage'),
        tone: 'danger',
      });
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
      label: t('members.table.member'),
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
      label: t('members.table.role'),
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
      label: t('members.table.status'),
      width: '1fr',
      render: () => (
        <span className={styles.status}>
          <span className={styles.statusDot} />
          {t('members.table.active')}
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
          aria-label={t('members.table.removeAria', { name: member.name ?? member.email })}
          title={t('members.table.removeTitle')}
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
        <h2 className={styles.title}>{t('members.title')}</h2>
        <span className={styles.eyebrow}>{t('members.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>{t('members.subtitle')}</p>

      <div className={styles.inviteBar}>
        <div className={styles.inviteInput}>
          <Input
            mono
            placeholder={t('members.invite.placeholder')}
            value={inviteUserId}
            onChange={(e) => setInviteUserId(e.target.value)}
          />
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
        <Button onClick={handleInvite}>{t('members.invite.button')}</Button>
      </div>

      <Table
        columns={columns}
        rows={members ?? []}
        rowKey={(m) => m.userId}
        emptyMessage={t('members.emptyMessage')}
      />
    </div>
  );
}

/**
 * Personal Access Tokens do runner local (`brb_…`, ADR 0105) — cada usuário
 * gerencia os PRÓPRIOS tokens deste projeto (RN-426); `maintainer`/`owner`
 * ganham, além disso, a visão de TODOS os tokens do projeto para resposta a
 * incidente (RN-427). O token bruto só existe no `emitido` LOCAL deste
 * componente, nunca no cache do react-query que também alimenta a listagem —
 * a lista nunca pode carregar o valor bruto.
 */
export function PersonalAccessTokensSection({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeGerenciarDeTodos =
    comPapel?.role === 'owner' || comPapel?.role === 'maintainer';
  const { data: tokens } = useQuery({
    queryKey: ['pats', projectId],
    queryFn: () => listPersonalAccessTokens(projectId),
  });
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [emitido, setEmitido] = useState<PersonalAccessTokenIssued | null>(null);
  const [copiado, setCopiado] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['pats', projectId] });
  }

  async function handleIssue() {
    if (!name.trim()) return;
    try {
      const dias = expiresInDays.trim() ? Number(expiresInDays) : undefined;
      const issued = await issuePersonalAccessToken(projectId, {
        name: name.trim(),
        expiresInDays: dias,
      });
      setName('');
      setExpiresInDays('');
      setCopiado(false);
      setEmitido(issued);
      invalidate();
    } catch {
      showToast({
        title: t('personalAccessTokens.toast.issueErrorTitle'),
        message: t('personalAccessTokens.toast.issueErrorMessage'),
        tone: 'danger',
      });
    }
  }

  async function handleRevoke(tokenId: string) {
    await revokePersonalAccessToken(projectId, tokenId);
    invalidate();
  }

  const { data: todosOsTokens } = useQuery({
    queryKey: ['pats-admin', projectId],
    queryFn: () => listAllPersonalAccessTokens(projectId),
    enabled: podeGerenciarDeTodos,
  });

  async function handleRevokeComoMaintainer(tokenId: string) {
    await revokePersonalAccessTokenAsMaintainer(projectId, tokenId);
    queryClient.invalidateQueries({ queryKey: ['pats-admin', projectId] });
  }

  async function copiarToken() {
    if (!emitido) return;
    try {
      await navigator.clipboard.writeText(emitido.token);
      setCopiado(true);
    } catch {
      showToast({
        title: t('personalAccessTokens.toast.copyErrorTitle'),
        message: t('personalAccessTokens.toast.copyErrorMessage'),
        tone: 'danger',
      });
    }
  }

  const columns: TableColumn<PersonalAccessTokenSummary>[] = [
    { key: 'name', label: t('personalAccessTokens.table.name'), width: '2fr', render: (pat) => pat.name },
    {
      key: 'createdAt',
      label: t('personalAccessTokens.table.created'),
      width: '1fr',
      render: (pat) => new Date(pat.createdAt).toLocaleDateString(i18n.language),
    },
    {
      key: 'expiresAt',
      label: t('personalAccessTokens.table.expires'),
      width: '1fr',
      render: (pat) =>
        pat.expiresAt
          ? new Date(pat.expiresAt).toLocaleDateString(i18n.language)
          : t('personalAccessTokens.table.expiresNever'),
    },
    {
      key: 'lastUsedAt',
      label: t('personalAccessTokens.table.lastUsed'),
      width: '1fr',
      render: (pat) =>
        pat.lastUsedAt
          ? new Date(pat.lastUsedAt).toLocaleDateString(i18n.language)
          : t('personalAccessTokens.table.lastUsedNever'),
    },
    {
      key: 'status',
      label: t('personalAccessTokens.table.status'),
      width: '120px',
      render: (pat) =>
        pat.revokedAt ? (
          <Badge tone="danger">{t('personalAccessTokens.table.statusRevoked')}</Badge>
        ) : (
          <span className={styles.status}>
            <span className={styles.statusDot} />
            {t('personalAccessTokens.table.statusActive')}
          </span>
        ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      render: (pat) =>
        pat.revokedAt ? null : (
          <button
            type="button"
            aria-label={t('personalAccessTokens.table.removeAria', { name: pat.name })}
            title={t('personalAccessTokens.table.removeTitle')}
            className={styles.remove}
            onClick={() => handleRevoke(pat.id)}
          >
            <TrashIcon size={14} />
          </button>
        ),
    },
  ];

  const colunasAdmin: TableColumn<PersonalAccessTokenAdminSummary>[] = [
    { key: 'name', label: 'Nome', width: '2fr', render: (t) => t.name },
    { key: 'userEmail', label: 'Dono', width: '2fr', render: (t) => t.userEmail },
    {
      key: 'createdAt',
      label: 'Criado',
      width: '1fr',
      render: (t) => new Date(t.createdAt).toLocaleDateString('pt-BR'),
    },
    {
      key: 'status',
      label: 'Status',
      width: '120px',
      render: (t) =>
        t.revokedAt ? (
          <Badge tone="danger">revogado</Badge>
        ) : (
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
      render: (t) =>
        t.revokedAt ? null : (
          <button
            type="button"
            aria-label={`Revogar ${t.name} (${t.userEmail})`}
            title="Revogar"
            className={styles.remove}
            onClick={() => handleRevokeComoMaintainer(t.id)}
          >
            <TrashIcon size={14} />
          </button>
        ),
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('personalAccessTokens.title')}</h2>
        <span className={styles.eyebrow}>{t('personalAccessTokens.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {t('personalAccessTokens.subtitle.before')}
        <code>brabo-runner</code>
        {t('personalAccessTokens.subtitle.after')}
      </p>

      <div className={styles.inviteBar}>
        <div className={styles.inviteInput}>
          <Input
            placeholder={t('personalAccessTokens.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className={styles.inviteRole}>
          <Input
            type="number"
            min={1}
            placeholder={t('personalAccessTokens.expiresPlaceholder')}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </div>
        <Button onClick={handleIssue}>{t('personalAccessTokens.generateButton')}</Button>
      </div>

      <Table
        columns={columns}
        rows={tokens ?? []}
        rowKey={(pat) => pat.id}
        emptyMessage={t('personalAccessTokens.emptyMessage')}
      />

      {podeGerenciarDeTodos && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.title}>Todos os tokens do projeto</h2>
            <span className={styles.eyebrow}>maintainer · RN-427</span>
          </div>
          <p className={styles.subtitle}>
            Resposta a incidente — revogue o token de qualquer usuário do
            projeto, não só o seu.
          </p>
          <Table
            columns={colunasAdmin}
            rows={todosOsTokens ?? []}
            rowKey={(t) => t.id}
            emptyMessage="Nenhum token de acesso emitido para este projeto."
          />
        </div>
      )}

      {emitido && (
        <Modal title={t('personalAccessTokens.modal.title')} onClose={() => setEmitido(null)}>
          <p className={styles.subtitle}>
            {t('personalAccessTokens.modal.bodyBefore')}
            <code>--token</code>
            {t('personalAccessTokens.modal.bodyMiddle')}
            <code>BRABO_ACCOUNT_TOKEN</code>
            {t('personalAccessTokens.modal.bodyAfter')}
            <code>brabo-runner</code>
            {t('personalAccessTokens.modal.bodyEnd')}
          </p>
          <Input mono readOnly value={emitido.token} onFocus={(e) => e.currentTarget.select()} />
          <Button onClick={copiarToken} variant="secondary">
            {copiado ? t('personalAccessTokens.modal.copiedButton') : t('personalAccessTokens.modal.copyButton')}
          </Button>
        </Modal>
      )}
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
  const { t } = useTranslation('settings');
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
        <h2 className={styles.title}>{t('repository.title')}</h2>
        <span className={styles.eyebrow}>{t('repository.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {repository.origin === 'adopted'
          ? t('repository.adopted')
          : t('repository.created')}
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
          {t('repository.dismissed.before')}
          <strong>{t('repository.dismissed.strong')}</strong>
          {t('repository.dismissed.after')}
        </Alert>
      )}

      {avisos.length > 0 && (
        <Alert tone="accent">
          <div>{t('repository.divergesTitle')}</div>
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
  const { t } = useTranslation('settings');
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
      showToast({ title: t('execution.toast.success'), tone: 'success' });
    } catch {
      showToast({ title: t('execution.toast.error'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('execution.title')}</h2>
        <span className={styles.eyebrow}>{t('execution.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>{t('execution.subtitle')}</div>

      <div className={styles.ajusteCard}>
        <div className={styles.ajusteInfo}>
          <div className={styles.ajusteTitulo}>{t('execution.card.title')}</div>
          <div className={styles.ajusteHint}>
            {project.maxConsecutiveBlocked === null
              ? t('execution.card.hintDefault', {
                  default: DEFAULT_MAX_CONSECUTIVE_BLOCKED,
                })
              : t('execution.card.hintConfigured')}
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
          {saving ? t('execution.saving') : t('execution.save')}
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
  const { t } = useTranslation('settings');
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
      showToast({ title: t('parallelism.toast.success', { area: key }), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('parallelism.toast.error')),
        tone: 'danger',
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('parallelism.title')}</h2>
        <span className={styles.eyebrow}>{t('parallelism.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {t('parallelism.subtitle.before')}
        <strong>{t('parallelism.subtitle.strong')}</strong>
        {t('parallelism.subtitle.after')}
      </div>

      {!areas || areas.length === 0 ? (
        <div className={styles.subtitle}>
          {t('parallelism.empty.before')}
          <code>{t('parallelism.empty.code')}</code>
          {t('parallelism.empty.after')}
        </div>
      ) : (
        areas.map((area) => {
          const exibido = drafts[area.key] ?? String(area.maxParallel);
          const numero = Number(exibido);
          const valido = Number.isInteger(numero) && numero >= 1;

          return (
            <div key={area.key} className={styles.ajusteCard}>
              <div className={styles.ajusteInfo}>
                <div className={styles.ajusteTitulo}>
                  {t('parallelism.card.title', { area: area.key })}
                </div>
                <div className={styles.ajusteHint}>
                  {t('parallelism.card.lead', { lead: area.leadAgentId })}
                  {area.members.length > 0
                    ? t('parallelism.card.membersCount', { count: area.members.length })
                    : t('parallelism.card.noMembersYet')}
                </div>
              </div>
              <div className={styles.ajusteNumero}>
                <Input
                  mono
                  type="number"
                  min={1}
                  aria-label={t('parallelism.card.capAria', { area: area.key })}
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
                {saving === area.key ? t('parallelism.saving') : t('parallelism.save')}
              </Button>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * O teto de GASTO de cada área, opcional (ADR 0109, RN-440).
 *
 * Mesmo padrão de `ParallelismSection` — uma linha por área, botão de salvar
 * explícito (não autosave, pelo mesmo motivo: salvar a cada tecla mandaria
 * `2` a caminho de `20`) —, mas o campo fala em DÓLAR (não micro-USD, que
 * ninguém digita) e aceita ficar vazio: vazio é "sem teto", o mesmo valor de
 * `budgetMicros: null`. Este teto é ADITIVO ao budget de projeto/sessão que
 * já existe na tela — não substitui nenhum dos dois, e não é a cascata de
 * modelo herdável do ADR 0064 (áreas diferentes, mecanismos diferentes).
 */
export function BudgetSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: areas } = useQuery({
    queryKey: ['agent-areas', projectId],
    queryFn: () => listAgentAreas(projectId),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  function draftFor(area: AgentArea): string {
    if (drafts[area.key] !== undefined) return drafts[area.key];
    return area.budgetMicros === null
      ? ''
      : String(microsParaUsd(area.budgetMicros));
  }

  async function handleSave(key: string, valor: number | null) {
    setSaving(key);
    try {
      await setAreaBudget(projectId, key, valor);
      await queryClient.invalidateQueries({
        queryKey: ['agent-areas', projectId],
      });
      setDrafts((d) => {
        const { [key]: _, ...resto } = d;
        return resto;
      });
      showToast({ title: t('budget.toast.success', { area: key }), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('budget.toast.error')),
        tone: 'danger',
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('budget.title')}</h2>
        <span className={styles.eyebrow}>{t('budget.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {t('budget.subtitle.before')}
        <strong>{t('budget.subtitle.strong')}</strong>
        {t('budget.subtitle.after')}
      </div>

      {!areas || areas.length === 0 ? (
        <div className={styles.subtitle}>
          {t('budget.empty.before')}
          <code>{t('budget.empty.code')}</code>
          {t('budget.empty.after')}
        </div>
      ) : (
        areas.map((area) => {
          const exibido = draftFor(area);
          // Vazio é um valor válido — "sem teto" — e não um erro digitando.
          const numero = exibido.trim() === '' ? null : Number(exibido);
          const valido =
            numero === null || (Number.isFinite(numero) && numero >= 0);

          return (
            <div key={area.key} className={styles.ajusteCard}>
              <div className={styles.ajusteInfo}>
                <div className={styles.ajusteTitulo}>
                  {t('budget.card.title', { area: area.key })}
                </div>
                <div className={styles.ajusteHint}>
                  {t('budget.card.spent', {
                    amount: formatarCustoMicros(area.spentMicros),
                  })}
                </div>
              </div>
              <div className={styles.ajusteNumero}>
                <Input
                  mono
                  type="number"
                  min={0}
                  step="any"
                  placeholder={t('budget.placeholder')}
                  aria-label={t('budget.card.capAria', { area: area.key })}
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
                {saving === area.key ? t('budget.saving') : t('budget.save')}
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
  const { t } = useTranslation('settings');
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
            ? t('promotion.toast.manual')
            : t('promotion.toast.auto'),
        tone: 'success',
      });
    } catch {
      showToast({ title: t('promotion.toast.error'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  if (!project) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('promotion.title')}</h2>
        <span className={styles.eyebrow}>{t('promotion.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {t('promotion.subtitle.before')}
        <em>{t('promotion.subtitle.em')}</em>
        {t('promotion.subtitle.after')}
      </div>

      <div className={styles.ajusteCard}>
        <div className={styles.ajusteInfo}>
          <div className={styles.ajusteTitulo}>{t('promotion.card.title')}</div>
          <div className={styles.ajusteHint}>
            {project.storyPromotion === 'manual'
              ? t('promotion.card.hintManual')
              : t('promotion.card.hintAuto')}
          </div>
        </div>
        <div className={styles.ajusteControle}>
          <Select
            value={project.storyPromotion}
            disabled={saving}
            aria-label={t('promotion.selectAria')}
            onChange={(e) =>
              handleChange(e.target.value as StoryPromotionMode)
            }
          >
            <option value="manual">{t('promotion.optionManual')}</option>
            <option value="auto">{t('promotion.optionAuto')}</option>
          </Select>
        </div>
      </div>
    </div>
  );
}

function MatrixSection() {
  const { t } = useTranslation('settings');
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('matrix.title')}</h2>
        <span className={styles.eyebrow}>{t('matrix.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>{t('matrix.subtitle')}</p>
      <div className={styles.matrixWrap}>
        <table className={styles.matrixTable}>
          <thead>
            <tr>
              <th>{t('matrix.columns.action')}</th>
              <th>owner</th>
              <th>maintainer</th>
              <th>developer</th>
              <th>viewer</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row.key}>
                <td>{t(`matrix.rows.${row.key}`)}</td>
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
          <span className={styles.check}>✓</span> {t('matrix.legend.canApprove')}
        </span>
        <span className={styles.matrixLegendaItem}>
          <span className={styles.dash}>—</span> {t('matrix.legend.noPermission')}
        </span>
      </div>
    </div>
  );
}

// Exportada para o teste, como ExecutionSection e PromotionSection.
export function CredentialsSection() {
  const { t, i18n } = useTranslation('settings');
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
      showToast({ title: t('credentials.toast.saved'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('credentials.toast.saveErrorTitle'),
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
        showToast({ title: t('credentials.toast.testOk'), tone: 'success' });
      } else if (resultado === 'recusado') {
        showToast({ title: t('credentials.toast.testRefused'), message: motivo, tone: 'danger' });
      } else {
        showToast({
          title: t('credentials.toast.testUnsupportedTitle'),
          message: t('credentials.toast.testUnsupportedMessage'),
          tone: 'warning',
        });
      }
    } catch (erro) {
      showToast({
        title: t('credentials.toast.testErrorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setEmVoo(null);
    }
  }

  async function handleRemove(provider: LlmCredentialProvider) {
    setEmVoo(provider);
    try {
      await deleteCredential(provider);
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      showToast({ title: t('credentials.toast.removed'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('credentials.toast.removeErrorTitle'),
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
        <h2 className={styles.title}>{t('credentials.title')}</h2>
        <span className={styles.eyebrow}>{t('credentials.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {t('credentials.subtitle.before')}
        <strong>{t('credentials.subtitle.swap')}</strong>
        {t('credentials.subtitle.middle')}
        <strong>{t('credentials.subtitle.test')}</strong>
        {t('credentials.subtitle.after')}
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
                    {kind === 'hub'
                      ? t('credentials.connector.hub')
                      : t('credentials.connector.provider')}
                  </div>
                </div>
                <span
                  className={[styles.conectorStatus, existing && styles.conectorAtivo]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className={styles.conectorPonto} />
                  {existing
                    ? t('credentials.connector.configured')
                    : t('credentials.connector.missing')}
                </span>
              </div>

              {/* O desenho mostra a chave mascarada. Aqui ela NÃO existe: a
                  credencial é write-only e nunca volta do servidor (ADR 0050).
                  Mostrar `sk-••••` seria inventar um prefixo que ninguém leu. */}
              <div className={styles.conectorNota}>
                {existing
                  ? t('credentials.connector.configuredNote', {
                      date: new Date(existing.updatedAt).toLocaleDateString(i18n.language),
                    })
                  : t('credentials.connector.noneSaved')}
              </div>

              {/* O input fica SEMPRE visível: com credencial salva ele é o
                  caminho da troca, que antes só existia removendo primeiro. */}
              <Input
                mono
                type="password"
                aria-label={
                  existing
                    ? t('credentials.connector.newKeyAria', { label })
                    : t('credentials.connector.apiKeyAria', { label })
                }
                placeholder={
                  existing
                    ? t('credentials.connector.swapPlaceholder')
                    : t('credentials.connector.apiKeyPlaceholder')
                }
                value={drafts[id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
              />

              <div className={styles.conectorAcoes}>
                {/* Nome acessível com o provider: são oito cards com botões de
                    texto idêntico, e "Salvar" sozinho não diz salvar o quê. */}
                <Button
                  aria-label={
                    existing
                      ? t('credentials.connector.swapKeyAria', { label })
                      : t('credentials.connector.saveKeyAria', { label })
                  }
                  disabled={ocupado || rascunho.length === 0}
                  onClick={() => handleSave(id)}
                >
                  {existing ? t('credentials.connector.swap') : t('credentials.connector.save')}
                </Button>
                {existing && (
                  <>
                    <Button
                      variant="secondary"
                      aria-label={t('credentials.connector.testKeyAria', { label })}
                      disabled={ocupado}
                      onClick={() => handleTest(id)}
                    >
                      {t('credentials.connector.test')}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={t('credentials.connector.removeKeyAria', { label })}
                      disabled={ocupado}
                      onClick={() => handleRemove(id)}
                    >
                      {t('credentials.connector.remove')}
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
// Exportada para o teste, como ExecutionSection e PromotionSection.
export function ProficiencySection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: profiles } = useProficiency(projectId);
  const [confirmandoDelete, setConfirmandoDelete] = useState(false);
  const [emVoo, setEmVoo] = useState(false);
  // A Anamnese pode estar pausada GLOBALMENTE (decisão do usuário em
  // 2026-08-10, não bug — ver docs/explanation/backlog.md). Não há hoje um
  // jeito de saber isso ANTES de clicar (o estado é do engine, não vem em
  // nenhuma leitura desta tela); "Rodar agora" descobre no primeiro clique e
  // o botão fica desabilitado dali em diante, com a explicação PERSISTENTE
  // na tela — não só um toast que some (RN-088: nunca falha silenciosa ou
  // confusa).
  const [anamneseDesativada, setAnamneseDesativada] = useState(false);

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
        title: t('proficiency.toast.deleted'),
        message: t('proficiency.toast.deletedMessage'),
        tone: 'success',
      });
    } catch {
      showToast({
        title: t('proficiency.toast.deleteErrorTitle'),
        message: t('proficiency.toast.deleteErrorMessage'),
        tone: 'danger',
      });
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
      showToast({
        title: t('proficiency.toast.reactivated'),
        message: t('proficiency.toast.reactivatedMessage'),
        tone: 'success',
      });
    } catch {
      showToast({
        title: t('proficiency.toast.reactivateErrorTitle'),
        message: t('proficiency.toast.reactivateErrorMessage'),
        tone: 'danger',
      });
    } finally {
      setEmVoo(false);
    }
  }

  async function handleRunNow() {
    setEmVoo(true);
    try {
      await runAnamnese(projectId);
      showToast({
        title: t('proficiency.toast.queued'),
        message: t('proficiency.toast.queuedMessage'),
        tone: 'success',
      });
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 503) {
        // Distinto de "projeto sem sessão" (409) — a api já manda a frase
        // pronta em `body.message` (ServiceUnavailableException do
        // RunAnamneseUseCase).
        setAnamneseDesativada(true);
        showToast({
          title: t('proficiency.toast.pausedTitle'),
          message: mensagemDaApi(erro, t('proficiency.toast.pausedFallback')),
          tone: 'warning',
        });
      } else {
        showToast({
          title: t('proficiency.toast.genericErrorTitle'),
          message: t('proficiency.toast.genericErrorMessage'),
          tone: 'danger',
        });
      }
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
        title: t('proficiency.toast.evidenceUnavailableTitle'),
        message: t('proficiency.toast.evidenceUnavailableMessage'),
        tone: 'danger',
      });
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('proficiency.title')}</h2>
        <span className={styles.eyebrow}>{t('proficiency.eyebrow')}</span>
      </div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        {t('proficiency.subtitle')}
      </div>

      {all.length === 0 ? (
        <div className={styles.subtitle}>{t('proficiency.emptyMessage')}</div>
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

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <Button
          variant="danger"
          disabled={emVoo}
          onClick={() => setConfirmandoDelete(true)}
        >
          {t('proficiency.deleteButton')}
        </Button>
        <Button variant="ghost" disabled={emVoo} onClick={handleOptIn}>
          {t('proficiency.reactivateButton')}
        </Button>
        <Button
          variant="secondary"
          disabled={emVoo || anamneseDesativada}
          onClick={handleRunNow}
          title={anamneseDesativada ? t('proficiency.runNowDisabledTitle') : undefined}
        >
          {t('proficiency.runNowButton')}
        </Button>
      </div>

      {/* Pausa GLOBAL (não é o opt-out por membro acima) — decisão do
          usuário em 2026-08-10, aguardando refinamento futuro. Fica visível
          de propósito, não só um toast que some (RN-088). */}
      {anamneseDesativada && (
        <div className={styles.subtitle} style={{ marginTop: 8 }}>
          {t('proficiency.pausedNotice')}
        </div>
      )}

      {/* Apagar é irreversível (e grava opt-out) — um clique cru era demais
          para uma ação que não tem como desfazer o que foi apagado. */}
      {confirmandoDelete && (
        <Modal
          title={t('proficiency.modal.title')}
          onClose={() => setConfirmandoDelete(false)}
        >
          <div className={styles.subtitle}>{t('proficiency.modal.body')}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="danger" onClick={handleDelete}>
              {t('proficiency.modal.confirm')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmandoDelete(false)}>
              {t('proficiency.modal.cancel')}
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
  const { t } = useTranslation('settings');
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
        title: t('instructionVersions.toast.revertedTitle'),
        message: t('instructionVersions.toast.revertedMessage', { agent, version }),
        tone: 'success',
      });
    } catch {
      showToast({
        title: t('instructionVersions.toast.errorTitle'),
        message: t('instructionVersions.toast.errorMessage'),
        tone: 'danger',
      });
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
        <h2 className={styles.title}>{t('instructionVersions.title')}</h2>
        <span className={styles.eyebrow}>{t('instructionVersions.eyebrow')}</span>
      </div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        {t('instructionVersions.subtitle')}
      </div>

      {withHistory.length === 0 ? (
        <div className={styles.subtitle}>{t('instructionVersions.emptyMessage')}</div>
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
                    {version.isCurrent && (
                      <Badge tone="success">{t('instructionVersions.current')}</Badge>
                    )}
                    {version.sourceHypothesisId && (
                      <Badge tone="accent">
                        {t('instructionVersions.hypothesis', {
                          id: version.sourceHypothesisId.slice(-8),
                        })}
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
                      {open
                        ? t('instructionVersions.hideDiff')
                        : t('instructionVersions.showDiff', {
                            additions: version.diff.additions,
                            deletions: version.diff.deletions,
                          })}
                    </button>
                    {!version.isCurrent && (
                      <Button
                        variant="secondary"
                        disabled={revertendo !== null}
                        onClick={() => handleRollback(agent.key, version.version)}
                      >
                        {revertendo === `${agent.key}:${version.version}`
                          ? t('instructionVersions.reverting')
                          : t('instructionVersions.revert')}
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


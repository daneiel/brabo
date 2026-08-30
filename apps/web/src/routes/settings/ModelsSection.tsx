import type { CSSProperties } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getProject,
  clearAgentModelBinding,
  getAgentModelBinding,
  getAreaModelBinding,
  getProjectAgentCosts,
  getProjectModelBinding,
  getWorkspaceModelBinding,
  listModels,
  setAgentModelBinding,
} from '../../lib/api-client';
import { AGENT_LIST, AREAS, areaFor } from '../../lib/agents';
import type { Model, ResolvedBinding } from '../../lib/api-types';
import { Table, type TableColumn } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { ModelPicker } from '../../components/ModelPicker';
import { ClockIcon } from '../../components/ui/icons';
import { ORIGIN_TONE, formatarCustoMicros } from './shared';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
    <SecaoDeConfiguracoes chave="models">
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
    </SecaoDeConfiguracoes>
  );
}

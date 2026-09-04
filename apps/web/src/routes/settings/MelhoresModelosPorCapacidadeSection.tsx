import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getProject,
  getAgentModelBinding,
  listModelCatalog,
} from '../../lib/api-client';
import { AGENT_LIST } from '../../lib/agents';
import type { ModelComCuradoria, UsoDeModelo } from '../../lib/api-types';
import { formatarPreco, ROTULO_DO_USO, USOS_DE_MODELO } from '../../lib/models';
import { Table, type TableColumn } from '../../components/ui/Table';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
    <SecaoDeConfiguracoes chave="best-models">
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
    </SecaoDeConfiguracoes>
  );
}

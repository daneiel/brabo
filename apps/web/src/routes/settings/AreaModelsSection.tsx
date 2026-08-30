import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  clearAreaModelBinding,
  getAreaModelBinding,
  listModels,
  mensagemDaApi,
  setAreaModelBinding,
} from '../../lib/api-client';
import { AREAS } from '../../lib/agents';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import type { Model } from '../../lib/api-types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ModelPicker } from '../../components/ModelPicker';
import { useToast } from '../../components/ui/ToastProvider';
import { ORIGIN_TONE } from './shared';
import styles from '../ProjectSettingsTab.module.css';
import { MarcaDeHeranca, useVoltarAHerdar } from './heranca';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
  const { rotulo: voltarAHerdar } = useVoltarAHerdar();
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
    <SecaoDeConfiguracoes chave="area-models">
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
              <div className={styles.ajusteHint}>
                {/* Sem detalhe nos dois polos: DE ONDE o valor vem quando a
                    área não tem o próprio é o que o Badge de origem ao lado do
                    título diz, e torná-lo uma cadeia legível é trabalho de
                    outra PR — a marca declara o ESTADO, não a cascata. */}
                <MarcaDeHeranca proprio={divergiuDoProjeto} />
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
                {voltarAHerdar}
              </Button>
            )}
          </div>
        );
      })}
    </SecaoDeConfiguracoes>
  );
}

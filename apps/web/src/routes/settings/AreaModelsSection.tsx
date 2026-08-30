import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  clearAreaModelBinding,
  getAreaModelBinding,
  getProjectModelBinding,
  getWorkspaceModelBinding,
  listModels,
  mensagemDaApi,
  setAreaModelBinding,
} from '../../lib/api-client';
import { AREAS } from '../../lib/agents';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { roleAtLeast } from '../../lib/roles';
import type { Model } from '../../lib/api-types';
import { Button } from '../../components/ui/Button';
import { ModelPicker } from '../../components/ModelPicker';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { MarcaDeHeranca, useVoltarAHerdar } from './heranca';
import { CadeiaDeCascata, montarCadeia } from './cascata';
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
  // Mesmo mínimo de antes (`owner || maintainer` é exatamente `>= maintainer`
  // em `ROLE_ORDER`), pela hierarquia em vez de por dois nomes escritos à mão:
  // a tabela de agentes acima passou a fazer a mesma pergunta com um mínimo
  // DIFERENTE (`developer`), e duas perguntas iguais escritas de dois jeitos é
  // como as duas voltam a divergir.
  const podeEditar = roleAtLeast(comPapel?.role, 'maintainer');

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

  // Os DOIS níveis acima da área, para a cadeia da cascata. As chaves são as
  // MESMAS de `ModelsSection` — as duas seções vivem na mesma aba, e o React
  // Query serve as duas com uma requisição por nível, não duas.
  const { data: bindingDoProjeto } = useQuery({
    queryKey: ['project-model-binding', projectId],
    queryFn: () => getProjectModelBinding(projectId),
  });
  // O workspace sai do par que esta seção JÁ consulta para decidir o papel —
  // buscar o projeto de novo só para ler `workspaceId` seria um round-trip a
  // mais pela mesma informação.
  const workspaceId = comPapel?.workspace?.id;
  const { data: bindingDoWorkspace } = useQuery({
    queryKey: ['workspace-model-binding', workspaceId],
    queryFn: () => getWorkspaceModelBinding(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  // Nome de exibição para os `title` da cadeia — mesma lista que o
  // `ModelPicker` desta seção já recebe, sem consulta a mais.
  const nomeDoModelo = (modelId: string) =>
    (modelsByCategory
      ? [
          ...Object.values(modelsByCategory.local).flat(),
          ...Object.values(modelsByCategory.cloud).flat(),
        ]
      : []
    ).find((m) => m.id === modelId)?.displayName;

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
                {/* A cadeia no lugar do enum cru (e do `—`). `origin: 'agent'`
                    aqui só pode ser o passo pós-cascata do Criativo: a consulta
                    de ÁREA não tem escopo de agente na cascata
                    (`ResolveModelBindingUseCase`), então não há o caso ambíguo
                    que a tabela de agentes tem. */}
                <CadeiaDeCascata
                  niveis={montarCadeia({
                    resolvido: resolved,
                    niveis: ['workspace', 'project', 'area'],
                    proprios: {
                      workspace: bindingDoWorkspace?.modelId,
                      project: bindingDoProjeto?.modelId,
                    },
                    herdadoDoStart: resolved?.origin === 'agent',
                  })}
                  rotulos={{
                    area: t('cascata.niveisComNome.area', { area: area.label }),
                  }}
                  nomeDoModelo={nomeDoModelo}
                  rotuloSemModelo={t('areaModels.originChainNoModel')}
                  tituloSemModelo={t('areaModels.originChainNoModelTitle')}
                />
              </div>
              <div className={styles.ajusteHint}>
                {t('areaModels.card.lead', { lead: area.lead })}
                {area.members.length > 0
                  ? t('areaModels.card.subagents', { list: area.members.join(', ') })
                  : t('areaModels.card.subagentsDynamic')}
              </div>
              <div className={styles.ajusteHint}>
                {/* Sem detalhe nos dois polos, e agora por um motivo mais forte
                    que o de antes: DE ONDE o valor vem é a CADEIA ao lado do
                    título, e a marca declara o ESTADO. A divisão é a que
                    `heranca.tsx` já previa — as duas peças não dizem a mesma
                    coisa de dois jeitos, dizem coisas diferentes. */}
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
                  // Marcado aqui pelo MESMO motivo da tabela de agentes, e não
                  // por analogia: `assertModelFitsBindingScope` exige tool
                  // calling em `agent` E em `area`. A área entrou nessa régua
                  // no ADR 0064 porque ela não é fallback genérico — o único
                  // consumidor do modelo de uma área é um agente dela —, então
                  // o 422 da RN-040 alcança quem escolhe daqui igualzinho.
                  filtroDeAgentesPadrao
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

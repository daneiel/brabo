import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listAgentAreas, setAreaMaxParallel } from '../../lib/api-client';
import type { AgentArea } from '../../lib/api-types';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';
import { MarcaDeNaoSalvo, useSecaoSalvavel } from './secao-salvavel';

/**
 * O teto de paralelismo de cada lead (FASE 14d — RN-083, ADR 0053).
 *
 * Uma linha por ÁREA, e não um número único do projeto: o trabalho de dev e o
 * de QA têm custos e formatos diferentes, e foi por isso que o ADR pôs o teto
 * na área. Tem botão de salvar, ao contrário do seletor de promoção logo
 * abaixo — é um número digitado, e salvar a cada tecla mandaria `1` a caminho
 * de `12`.
 *
 * O botão é UM, da seção, e não um por linha (`settings/secao-salvavel.tsx`):
 * revisar o teto de dev quase nunca é revisar só o de dev, e N botões idênticos
 * pediam N cliques para uma decisão só. O que a seção passou a dever em troca é
 * dizer quantas linhas estão pendentes, e nunca afirmar que salvou uma linha que
 * a api recusou — as N chamadas não são uma transação, e o hook trata cada
 * desfecho por linha.
 *
 * Vazio para projeto que nunca ativou execução, e a tela DIZ isso em vez de
 * sumir: seção que desaparece parece bug, e o motivo (as áreas nascem do
 * `module_map`) não é adivinhável.
 */
export function ParallelismSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { data: areas } = useQuery({
    queryKey: ['agent-areas', projectId],
    queryFn: () => listAgentAreas(projectId),
  });

  const secao = useSecaoSalvavel<AgentArea, number>({
    itens: areas,
    chaveDe: (area) => area.key,
    textoDoServidor: (area) => String(area.maxParallel),
    // Zero não é "sem limite" — é configuração inválida, e a api recusa.
    interpretar: (texto) => {
      const numero = Number(texto);
      return Number.isInteger(numero) && numero >= 1
        ? { valido: true, valor: numero }
        : { valido: false };
    },
    salvar: (chave, valor) => setAreaMaxParallel(projectId, chave, valor),
    aoConcluir: () =>
      queryClient.invalidateQueries({ queryKey: ['agent-areas', projectId] }),
    sucessoDeUm: (chave) => t('parallelism.toast.success', { area: chave }),
    erroGenerico: t('parallelism.toast.error'),
  });

  return (
    <SecaoDeConfiguracoes chave="parallelism">
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
        <>
          {areas.map((area) => (
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
                  value={secao.textoDe(area)}
                  onChange={(e) => secao.editar(area.key, e.target.value)}
                />
              </div>
            </div>
          ))}

          <div className={styles.acoesDaSecao}>
            <Button
              onClick={() => void secao.salvarSecao()}
              disabled={!secao.podeSalvar}
            >
              {secao.salvando ? t('parallelism.saving') : t('parallelism.save')}
            </Button>
            <MarcaDeNaoSalvo sujas={secao.sujas} invalidas={secao.invalidas} />
          </div>
        </>
      )}
    </SecaoDeConfiguracoes>
  );
}

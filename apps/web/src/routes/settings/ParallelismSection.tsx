import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listAgentAreas,
  mensagemDaApi,
  setAreaMaxParallel,
} from '../../lib/api-client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
    </SecaoDeConfiguracoes>
  );
}

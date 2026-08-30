import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listAgentAreas,
  mensagemDaApi,
  setAreaBudget,
} from '../../lib/api-client';
import type { AgentArea } from '../../lib/api-types';
import { microsParaUsd } from '../../lib/currency';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import { formatarCustoMicros } from './shared';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/**
 * O teto de GASTO de cada área, opcional (ADR 0110, RN-443).
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
    <SecaoDeConfiguracoes chave="budget">
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
    </SecaoDeConfiguracoes>
  );
}

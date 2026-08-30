import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getProject, updateProject } from '../../lib/api-client';
import type { StoryPromotionMode } from '../../lib/api-types';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';

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

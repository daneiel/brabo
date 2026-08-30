import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getProject, updateProject } from '../../lib/api-client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
    <SecaoDeConfiguracoes chave="execution">
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
    </SecaoDeConfiguracoes>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getBootstrapPlan, getRepository } from '../../lib/api-client';
import { divergencias } from '../../lib/adoption';
import { Alert } from '../../components/ui/Alert';
import { BranchIcon } from '../../components/ui/icons';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
export function RepositorySection({ projectId }: { projectId: string }) {
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
    <SecaoDeConfiguracoes chave="repository">
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
    </SecaoDeConfiguracoes>
  );
}

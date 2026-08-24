import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { TerminalIcon } from './ui/icons';
import styles from './RunnerOnboardingPanel.module.css';

interface RunnerOnboardingPanelProps {
  projectId: string;
  /** Mensagem específica do que falhou (ex.: `pty_error`, erro de ticket) — cai no genérico quando ausente. */
  mensagem?: string;
  /** Reconsulta a conexão. Ausente = painel só informativo (sem botão). */
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/**
 * Onboarding de instalação do Runner (item 4.3/ADR sobre navegação de pasta
 * via o Runner) — painel compartilhado por três lugares: `TerminalPanel`
 * (estado "sem runner" da aba Terminal, RN-088), `FolderBrowserModal` (sem
 * como navegar sem runner) e `NewProjectWizard` (modo Local sem runner
 * conectado). Um só texto de instalação, uma só régua de "está conectado?".
 */
export function RunnerOnboardingPanel({
  projectId,
  mensagem,
  onRetry,
  retrying,
  className,
}: RunnerOnboardingPanelProps) {
  const { t } = useTranslation('terminal');
  return (
    <div className={[styles.painel, className].filter(Boolean).join(' ')} role="status">
      <TerminalIcon size={22} />
      <p className={styles.mensagem}>{mensagem || t('runnerOnboarding.defaultMessage')}</p>
      <div className={styles.instrucao}>
        <p>
          {t('runnerOnboarding.instructionPrefix')} <code>apps/runner/README.md</code>
          {t('runnerOnboarding.instructionSuffix')}
        </p>
        <code className={styles.comando}>{t('runnerOnboarding.command', { projectId })}</code>
        <p className={styles.detalhe}>{t('runnerOnboarding.detail')}</p>
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry} loading={retrying}>
          {t('runnerOnboarding.retryButton')}
        </Button>
      )}
    </div>
  );
}

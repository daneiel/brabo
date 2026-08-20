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
  return (
    <div className={[styles.painel, className].filter(Boolean).join(' ')} role="status">
      <TerminalIcon size={22} />
      <p className={styles.mensagem}>{mensagem || 'Nenhum runner conectado a este projeto.'}</p>
      <div className={styles.instrucao}>
        <p>
          Na sua máquina, dentro do checkout do Brabo (ver{' '}
          <code>apps/runner/README.md</code>):
        </p>
        <code className={styles.comando}>
          pnpm --filter runner start -- --project {projectId} --dir &lt;pasta&gt;
        </code>
        <p className={styles.detalhe}>
          O runner conecta automaticamente assim que estiver rodando — nenhuma
          ação nova precisa acontecer aqui.
        </p>
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry} loading={retrying}>
          Já instalei, conectar
        </Button>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API_URL } from '../lib/api-client';
import {
  baixarKitManual,
  configurarPastaAutomaticamente,
  detectarPlataforma,
  plataformasSuportadas,
  suportaEscritaDeArquivos,
  type RunnerPlatform,
} from '../lib/runner-bootstrap';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';
import { TerminalIcon } from './ui/icons';
import styles from './RunnerOnboardingPanel.module.css';

interface RunnerOnboardingPanelProps {
  /**
   * `null` quando o projeto ainda não existe (passo `workspace` do
   * `NewProjectWizard`, ANTES da criação antecipada — RN-437/ADR 0108): a
   * configuração automática precisa de um id real para registrar a chave de
   * dispositivo, então só o comando manual (com placeholder) fica visível.
   */
  projectId: string | null;
  /** Mensagem específica do que falhou (ex.: `pty_error`, erro de ticket) — cai no genérico quando ausente. */
  mensagem?: string;
  /** Reconsulta a conexão. Ausente = painel só informativo (sem botão). */
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  /**
   * Caminho já digitado pelo usuário (só o `NewProjectWizard` passa isto,
   * antes de o runner confirmar nada) — usado só para deixar o comando
   * manual mais fiel ao que a pessoa já escreveu.
   */
  caminhoSugerido?: string;
}

type EstadoAutomatico =
  | { fase: 'idle' }
  | { fase: 'configurando' }
  | { fase: 'baixando' }
  | { fase: 'sucesso'; instrucaoFinal: string }
  | { fase: 'kitBaixado' }
  | { fase: 'erro'; mensagem: string };

/**
 * Onboarding de instalação do Runner (ADR sobre navegação de pasta via o
 * Runner) — painel compartilhado por TRÊS lugares: `TerminalPanel` (estado
 * "sem runner" da aba Terminal, RN-088), `FolderBrowserModal` (sem como
 * navegar sem runner) e `NewProjectWizard` (passo `workspace`, modo
 * `runner`). Um só texto de instalação, uma só régua de "está conectado?".
 *
 * Além do comando manual de sempre (agora sempre com `--token`, e escondido
 * atrás de um `<details>` colapsável — "prefiro rodar manualmente"), oferece
 * um caminho que não pede PAT nenhum: gera um par de chaves Ed25519 NO
 * PRÓPRIO NAVEGADOR, registra a pública no projeto e grava o binário já
 * configurado numa pasta real (File System Access API, só Chromium) ou, fora
 * disso, dispara dois downloads comuns pro usuário mover à mão
 * (`lib/runner-bootstrap.ts`).
 */
export function RunnerOnboardingPanel({
  projectId,
  mensagem,
  onRetry,
  retrying,
  className,
  caminhoSugerido,
}: RunnerOnboardingPanelProps) {
  const { t } = useTranslation('terminal');
  const [suportaFS] = useState(() => suportaEscritaDeArquivos());
  const [plataforma, setPlataforma] = useState<RunnerPlatform | null>(null);
  const [detectandoPlataforma, setDetectandoPlataforma] = useState(true);
  const [plataformaManual, setPlataformaManual] = useState<RunnerPlatform>('linux-x64');
  const [estado, setEstado] = useState<EstadoAutomatico>({ fase: 'idle' });
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    void detectarPlataforma().then((detectada) => {
      if (cancelado) return;
      setPlataforma(detectada);
      setDetectandoPlataforma(false);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  const modoAutomatico = suportaFS && plataforma !== null;
  const plataformaEfetiva = plataforma ?? plataformaManual;

  async function handleConfigurarAutomaticamente() {
    if (!projectId) return;
    setEstado({ fase: 'configurando' });
    try {
      const { instrucaoFinal } = await configurarPastaAutomaticamente({
        projectId,
        apiUrl: API_URL,
        platform: plataformaEfetiva,
      });
      setCopiado(false);
      setEstado({ fase: 'sucesso', instrucaoFinal });
    } catch (erro) {
      setEstado({
        fase: 'erro',
        mensagem: erro instanceof Error ? erro.message : t('runnerOnboarding.autoConfigureError'),
      });
    }
  }

  async function handleBaixarKit() {
    if (!projectId) return;
    setEstado({ fase: 'baixando' });
    try {
      await baixarKitManual({ projectId, apiUrl: API_URL, platform: plataformaEfetiva });
      setEstado({ fase: 'kitBaixado' });
    } catch (erro) {
      setEstado({
        fase: 'erro',
        mensagem: erro instanceof Error ? erro.message : t('runnerOnboarding.autoConfigureError'),
      });
    }
  }

  async function copiarInstrucao() {
    if (estado.fase !== 'sucesso') return;
    try {
      await navigator.clipboard.writeText(estado.instrucaoFinal);
      setCopiado(true);
    } catch {
      // Sem toast dedicado aqui — o bloco de código já é copiável à mão
      // (`user-select: all`), então a falha do clipboard não bloqueia nada.
    }
  }

  const comandoManual = t('runnerOnboarding.command', {
    projectId: projectId ?? t('runnerOnboarding.placeholderProjectId'),
    caminho: caminhoSugerido?.trim() || t('runnerOnboarding.placeholderPath'),
  });

  return (
    <div className={[styles.painel, className].filter(Boolean).join(' ')} role="status">
      <TerminalIcon size={22} />
      <p className={styles.mensagem}>
        {mensagem || (projectId ? t('runnerOnboarding.defaultMessage') : t('runnerOnboarding.noProjectMessage'))}
      </p>

      {projectId && (
        <div className={styles.acoesAutomaticas}>
          {modoAutomatico ? (
            <Button type="button" onClick={() => void handleConfigurarAutomaticamente()} loading={estado.fase === 'configurando'}>
              {estado.fase === 'configurando'
                ? t('runnerOnboarding.autoConfiguring')
                : t('runnerOnboarding.autoConfigureButton')}
            </Button>
          ) : (
            <>
              {!detectandoPlataforma && plataforma === null && (
                <label className={styles.selecaoPlataforma}>
                  {t('runnerOnboarding.platformSelectLabel')}
                  <select
                    value={plataformaManual}
                    onChange={(e) => setPlataformaManual(e.target.value as RunnerPlatform)}
                  >
                    {plataformasSuportadas().map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button type="button" variant="secondary" onClick={() => void handleBaixarKit()} loading={estado.fase === 'baixando'}>
                {estado.fase === 'baixando'
                  ? t('runnerOnboarding.downloadingKit')
                  : t('runnerOnboarding.downloadKitButton')}
              </Button>
              <p className={styles.detalhe}>{t('runnerOnboarding.downloadKitNote')}</p>
            </>
          )}
        </div>
      )}

      {estado.fase === 'erro' && (
        <Alert tone="danger" role="alert">
          {estado.mensagem}
        </Alert>
      )}

      {estado.fase === 'kitBaixado' && <Alert tone="success">{t('runnerOnboarding.downloadKitDone')}</Alert>}

      {estado.fase === 'sucesso' && (
        <div className={styles.instrucao}>
          <p>{t('runnerOnboarding.successIntro')}</p>
          <code className={styles.comando}>{estado.instrucaoFinal}</code>
          <Button type="button" variant="secondary" onClick={() => void copiarInstrucao()}>
            {copiado ? t('runnerOnboarding.copiedButton') : t('runnerOnboarding.copyButton')}
          </Button>
        </div>
      )}

      <details className={styles.manual}>
        <summary>{t('runnerOnboarding.manualDisclosureSummary')}</summary>
        <div className={styles.instrucao}>
          <p>
            {t('runnerOnboarding.instructionPrefix')} <code>apps/runner/README.md</code>
            {t('runnerOnboarding.instructionSuffix')}
          </p>
          <code className={styles.comando}>{comandoManual}</code>
          <p className={styles.detalhe}>{t('runnerOnboarding.detail')}</p>
        </div>
      </details>

      {onRetry && (
        <Button type="button" variant="secondary" onClick={onRetry} loading={retrying}>
          {t('runnerOnboarding.retryButton')}
        </Button>
      )}
    </div>
  );
}

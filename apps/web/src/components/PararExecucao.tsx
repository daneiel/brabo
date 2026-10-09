import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { mensagemDaApi, transitionSession } from '../lib/api-client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import styles from './ModoAutomaticoDoTime.module.css';

export interface PararExecucaoProps {
  projectId: string;
  sessionId: string;
  /** Quantos dev agents estão com task em curso agora (da janela de eventos). */
  tarefasEmCurso: number;
  /** Encerrar sessão pede `developer` no endpoint (RN-650). */
  podeParar: boolean;
}

/**
 * "Parar execução" na aba Executores (RN-763, AT-456). O mecanismo é o
 * FECHAMENTO da sessão de execução — o mesmo `transition` da barra da sessão
 * — e é o engine que, ao ver a sessão fechada, para os dev agents dela e os
 * gates, bloqueia a task em curso com o trabalho preservado e não grava o
 * turno. Nenhum estado novo. A confirmação diz o que FICA antes do clique.
 */
export function PararExecucao({ projectId, sessionId, tarefasEmCurso, podeParar }: PararExecucaoProps) {
  const { t } = useTranslation('executors');
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function parar() {
    setEnviando(true);
    setErro(null);
    try {
      await transitionSession(projectId, sessionId, 'closing');
      await transitionSession(projectId, sessionId, 'closed');
      setConfirmando(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['execution-session', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['sessions', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] }),
      ]);
    } catch (e) {
      setErro(mensagemDaApi(e, t('parar.erro')));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.card} data-testid="parar-execucao">
      <p className={styles.texto}>{t('parar.descricao')}</p>
      <Button variant="danger" onClick={() => setConfirmando(true)} disabled={!podeParar}>
        {t('parar.botao')}
      </Button>
      {!podeParar && <p className={styles.texto}>{t('parar.semPapel')}</p>}
      {confirmando && (
        <Modal title={t('parar.confirmarTitulo')} onClose={() => setConfirmando(false)}>
          <ul data-testid="parar-execucao-o-que-fica">
            <li>{t('parar.ficaTarefas', { count: tarefasEmCurso })}</li>
            <li>{t('parar.ficaPrs')}</li>
            <li>{t('parar.ficaAprovacoes')}</li>
            <li>{t('parar.retomar')}</li>
          </ul>
          {erro && <p role="alert">{erro}</p>}
          <Button variant="danger" onClick={() => void parar()} disabled={enviando}>
            {t('parar.confirmar')}
          </Button>
        </Modal>
      )}
    </div>
  );
}

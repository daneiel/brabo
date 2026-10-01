import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { cancelQueuedAgentMessage } from '../lib/api-client';
import { mensagemDaRecusaDoAgente } from '../lib/recusa-do-agente';
import type { EstadoNaFila } from '../lib/fila-de-mensagens';
import { useToast } from '../components/ui/ToastProvider';
import { Button } from '../components/ui/Button';
import { nomeDoAgente } from '../lib/agents';
import styles from './SessionPage.module.css';

/**
 * O selo de uma mensagem que esperou na fila de um agente (RN-673, ADR 0191):
 * "na fila de <agente>" com o botão de cancelar, ou "cancelada" depois.
 *
 * O botão só existe para QUEM ENVIOU (`podeCancelar` — a api recusa os demais
 * com 403) e com a sessão ativa. Cancelar não é otimista: a mensagem só deixa
 * de estar "na fila" quando o log disser (`chat.message_cancelled`) — o
 * engine pode tê-la entregue no mesmo instante, e aí a recusa dele (409) é a
 * resposta certa, dita no toast.
 */
export function SeloDaFila({
  projectId,
  sessionId,
  mensagemId,
  estado,
  podeCancelar,
}: {
  projectId: string;
  sessionId: string;
  mensagemId: string;
  estado: EstadoNaFila;
  podeCancelar: boolean;
}) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [cancelando, setCancelando] = useState(false);

  if (estado.estado === 'cancelada') {
    return (
      <span className={styles.seloDaFila} data-estado="cancelada">
        {t('fila.cancelada')}
      </span>
    );
  }

  async function cancelar() {
    if (estado.estado !== 'naFila') return;
    setCancelando(true);
    try {
      await cancelQueuedAgentMessage(projectId, sessionId, estado.agente, mensagemId);
    } catch (erro) {
      const status = (erro as { status?: unknown } | null)?.status;
      showToast({
        title: t('toasts.erro'),
        message:
          status === 403
            ? t('fila.cancelarSoAutor')
            : mensagemDaRecusaDoAgente(erro, t('fila.erroCancelar')),
        tone: 'danger',
      });
    } finally {
      setCancelando(false);
      void queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
    }
  }

  return (
    <span className={styles.seloDaFila} data-estado="naFila">
      {t('fila.naFila', { agente: nomeDoAgente(estado.agente) })}
      {podeCancelar && (
        <Button size="sm" variant="ghost" loading={cancelando} onClick={cancelar}>
          {t('fila.cancelar')}
        </Button>
      )}
    </span>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { cancelQueuedAgentMessage } from '../lib/api-client';
import { mensagemDaRecusaDoAgente } from '../lib/recusa-do-agente';
import { estadosNaFila } from '../lib/fila-de-mensagens';
import { autorDaMensagem, type ContextoDeAutoria } from '../lib/autor-da-mensagem';
import type { SessionEvent } from '../lib/api-types';
import { useToast } from '../components/ui/ToastProvider';
import { Queue } from '../components/ai-elements/queue';
import { nomeDoAgente } from '../lib/agents';

/**
 * O painel das mensagens que esperam na fila de um agente (RN-673, ADR 0191;
 * AT-683 v5 — substitui o selo sob cada mensagem). Derivado do log, como o
 * engine o deriva. Cancelar só para QUEM ENVIOU e com a sessão ativa; não é
 * otimista: o item só sai quando o log disser (`chat.message_cancelled`), e a
 * recusa do engine (409) é dita no toast.
 */
export function PainelDaFila({
  projectId,
  sessionId,
  events,
  autoria,
  isActive,
}: {
  projectId: string;
  sessionId: string;
  events: readonly SessionEvent[];
  autoria: ContextoDeAutoria;
  isActive: boolean;
}) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [cancelando, setCancelando] = useState(false);

  const itens = [...estadosNaFila(events)].flatMap(([id, estado]) => {
    if (estado.estado !== 'naFila') return [];
    const e = events.find((x) => x.id === id);
    const texto = (e?.payload as { text?: unknown } | undefined)?.text;
    return [
      {
        id,
        agente: estado.agente,
        texto: `${nomeDoAgente(estado.agente)}: ${typeof texto === 'string' ? texto : ''}`,
        podeCancelar: isActive && autorDaMensagem(e?.actor, autoria).tipo === 'voce',
      },
    ];
  });
  if (itens.length === 0) return null;

  async function cancelar(id: string) {
    const agente = itens.find((i) => i.id === id)?.agente;
    if (!agente) return;
    setCancelando(true);
    try {
      await cancelQueuedAgentMessage(projectId, sessionId, agente, id);
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
    <div data-testid="painel-da-fila" aria-label={t('fila.painel')}>
      <Queue itens={itens} rotuloCancelar={t('fila.cancelar')} onCancelar={(id) => void cancelar(id)} desabilitado={cancelando} />
    </div>
  );
}

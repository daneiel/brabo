import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { sendAgentMessage } from './api-client';
import { mensagemDaRecusaDoAgente } from './recusa-do-agente';
import { nomeDoAgente } from './agents';
import { useToast } from '../components/ui/ToastProvider';

/**
 * Mandar mensagem a um agente ENQUANTO um turno está em curso (RN-673, ADR
 * 0191). Até aqui o composer travava durante o turno, e a mensagem que chegava
 * por outra porta (outra aba, outra pessoa) era 409 `turno_em_andamento` —
 * gravada e nunca lida. Agora ela entra na FILA do agente.
 *
 * O que este caminho NÃO faz, de propósito: armar um turno novo na tela
 * (`iniciarTurnoDoAgente`, bolha otimista). O turno em curso continua sendo o
 * acompanhado; a mensagem aparece no fio pelo log (o `chat.message` e o
 * `chat.message_queued` que a deixa "na fila"). Se o engine respondeu `lida`
 * — o turno acabou no meio do caminho e esta subiu um turno próprio —, a tela
 * passa a acompanhá-lo pelo log, como no envio normal.
 *
 * Recusa devolve o texto ao campo (ele já tinha saído) e diz a frase da api —
 * inclusive a do teto da fila (409 `fila_de_mensagens_cheia`).
 */
export function useEnfileirarMensagem(
  projectId: string,
  sessionId: string,
  setDraft: Dispatch<SetStateAction<string>>,
  acompanharTurnoPeloLog: (agente: string) => void,
) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useCallback(
    async (text: string, agente: string) => {
      setDraft('');
      try {
        const resposta = await sendAgentMessage(projectId, sessionId, agente, text);
        if (resposta?.entrega === 'enfileirada') {
          showToast({
            title: t('composer.enfileirar'),
            message: t('fila.enfileirada', {
              agente: nomeDoAgente(agente),
              posicao: resposta.posicao ?? 1,
            }),
            tone: 'accent',
          });
        } else {
          acompanharTurnoPeloLog(agente);
        }
      } catch (erro) {
        setDraft((atual) => atual || text);
        showToast({
          title: t('toasts.erro'),
          message: mensagemDaRecusaDoAgente(erro, t('toasts.erroEnviarMensagem')),
          tone: 'danger',
        });
      } finally {
        void queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      }
    },
    [projectId, sessionId, setDraft, acompanharTurnoPeloLog, showToast, t, queryClient],
  );
}

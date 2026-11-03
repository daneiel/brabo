import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { mensagemDaApi, transitionSession } from '../lib/api-client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { useBacklog } from '../lib/hooks';
import { contarTarefasAfetadasAoParar } from '../lib/execution';
import { INTERVALO_DO_PROJETO_MS } from '../lib/canal-vivo';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup } from './shadcn/item';
import { Square } from 'lucide-react';

export interface PararExecucaoProps {
  projectId: string;
  sessionId: string;
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
export function PararExecucao({ projectId, sessionId, podeParar }: PararExecucaoProps) {
  const { t } = useTranslation('executors');
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // RN-815 (AT-488): a contagem vem do backlog, lido só com a confirmação
  // aberta (nenhuma requisição a mais enquanto ela está fechada, RN-632).
  const backlog = useBacklog(confirmando ? projectId : undefined, INTERVALO_DO_PROJETO_MS);
  const afetadas = backlog.data ? contarTarefasAfetadasAoParar(backlog.data) : null;

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
    <Item variant="outline" style={{ margin: "12px 0" }} data-testid="parar-execucao">
      <ItemContent>
        <ItemDescription>{t('parar.descricao')}</ItemDescription>
        {!podeParar && <ItemDescription>{t('parar.semPapel')}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        <Button variant="danger" onClick={() => setConfirmando(true)} disabled={!podeParar}>
          <Square aria-hidden="true" />
          {t('parar.botao')}
        </Button>
      </ItemActions>
      {confirmando && (
        <Modal title={t('parar.confirmarTitulo')} onClose={() => setConfirmando(false)}>
          <ItemGroup data-testid="parar-execucao-o-que-fica">
            {afetadas === null ? (
              <Item size="xs" role="listitem" aria-busy="true">
                {backlog.isError ? t('parar.tarefasNaoLidas') : t('parar.lendoTarefas')}
              </Item>
            ) : afetadas.emCurso + afetadas.emRevisao === 0 ? (
              <Item size="xs" role="listitem">{t('parar.nenhumaTarefa')}</Item>
            ) : (
              <>
                {afetadas.emCurso > 0 && (
                  <Item size="xs" role="listitem">{t('parar.ficaTarefas', { count: afetadas.emCurso })}</Item>
                )}
                {afetadas.emRevisao > 0 && (
                  <Item size="xs" role="listitem">{t('parar.ficaRevisao', { count: afetadas.emRevisao })}</Item>
                )}
              </>
            )}
            <Item size="xs" role="listitem">{t('parar.ficaPrs')}</Item>
            <Item size="xs" role="listitem">{t('parar.ficaAprovacoes')}</Item>
            <Item size="xs" role="listitem">{t('parar.retomar')}</Item>
          </ItemGroup>
          {erro && <p role="alert">{erro}</p>}
          <Button variant="danger" onClick={() => void parar()} disabled={enviando}>
            <Square aria-hidden="true" />
            {t('parar.confirmar')}
          </Button>
        </Modal>
      )}
    </Item>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { activateExecution, mensagemDaApi } from '../lib/api-client';
import { Button } from './ui/Button';
import styles from './ModoAutomaticoDoTime.module.css';

export interface ReligarExecucaoProps {
  projectId: string;
  /** Tarefas do backlog que não estão `done` (`contarTarefasPendentes`). */
  tarefasPendentes: number;
}

/**
 * RN-794 (AT-469): sem execução vigente e com tarefa pendente, a tela diz
 * quantas são e oferece RELIGAR pelo MESMO `POST .../execution/activate`
 * (`ActivateExecutionUseCase`) do botão "Ativar execução" — nenhuma régua
 * nova. Sem `originSessionId`, como a Visão geral sempre chamou: não há
 * sessão de chat de onde o clique partiu para a api fechar (RN-135); a api
 * abre a sessão de execução nova. A recusa (409 sem repositório, sessão
 * consultiva, papel) aparece com a frase da api, em texto, ao lado do botão.
 */
export function ReligarExecucao({ projectId, tarefasPendentes }: ReligarExecucaoProps) {
  const { t } = useTranslation('executors');
  const queryClient = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function religar() {
    setEnviando(true);
    setErro(null);
    try {
      await activateExecution(projectId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['execution-session', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['sessions', projectId] }),
      ]);
    } catch (e) {
      setErro(mensagemDaApi(e, t('religar.erro')));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.card} data-testid="religar-execucao">
      <p className={styles.texto}>{t('religar.descricao', { count: tarefasPendentes })}</p>
      <Button variant="primary" onClick={() => void religar()} disabled={enviando}>
        {t('religar.botao')}
      </Button>
      {erro && (
        <p className={styles.texto} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import type { SessionEvent } from '../lib/api-types';
import { ehDevAgent, sessaoTemExecucao } from '../lib/sessao-de-execucao';

/**
 * Encerrar sessão com execução ativa PERGUNTA antes (AT-452, RN-769): o clique
 * fechava a sessão em 3 s com o dev agent no meio de um comando. Sem execução,
 * o clique encerra direto, como sempre.
 */
export function useEncerrarComConfirmacao(
  encerrar: () => Promise<void>,
  events: readonly Pick<SessionEvent, 'type'>[],
  ativados: readonly string[],
): { pedirEncerramento: () => Promise<void>; modalDeEncerrar: ReactNode } {
  const { t } = useTranslation('sessionPage');
  const temExecucao = sessaoTemExecucao(events, ativados);
  const devsAtivos = ativados.filter(ehDevAgent);
  const [aberto, setAberto] = useState(false);
  const [encerrando, setEncerrando] = useState(false);

  async function pedirEncerramento() {
    if (temExecucao) {
      setAberto(true);
      return;
    }
    await encerrar();
  }

  async function confirmar() {
    setEncerrando(true);
    try {
      await encerrar();
      setAberto(false);
    } finally {
      setEncerrando(false);
    }
  }

  const modal = aberto ? (
    <Modal title={t('encerrar.titulo')} onClose={() => setAberto(false)}>
      <div data-testid="confirmar-encerramento">
        <p>{t('encerrar.oQuePara')}</p>
        {devsAtivos.length > 0 && (
          <p>{t('encerrar.agentes', { agentes: devsAtivos.join(', ') })}</p>
        )}
        <p>{t('encerrar.semReabrir')}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setAberto(false)}>
            {t('encerrar.cancelar')}
          </Button>
          <Button variant="danger" loading={encerrando} onClick={() => void confirmar()}>
            {t('encerrar.confirmar')}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { pedirEncerramento, modalDeEncerrar: modal };
}

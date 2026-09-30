import { useTranslation } from 'react-i18next';
import { mensagemDaApi } from '../../lib/api-client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import styles from '../ProjectSettingsTab.module.css';

/**
 * Os dois estados da leitura em lote dos bindings (RN-654) que NÃO são
 * resposta — e que por isso não podem ser desenhados como "sem modelo".
 *
 * Antes do lote, uma linha ainda carregando caía na mesma marca de "sem modelo
 * em nenhum nível" que a linha que a api afirmou não ter modelo, e uma linha
 * cuja leitura falhou também. Com uma leitura só para as 20 chaves, a falha é
 * de todas de uma vez, e colapsá-la em "sem modelo" faria a seção inteira
 * afirmar o contrário do que sabe (RN-470).
 */

/** O motivo da falha, dito UMA vez na seção, com a ação de reler. */
export function AvisoDeBindingsNaoLidos({
  erro,
  tentarDeNovo,
}: {
  erro: unknown;
  tentarDeNovo: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div role="alert" className={styles.subtitle}>
      {t('resolvedBindings.readError', {
        reason: mensagemDaApi(erro, t('resolvedBindings.readErrorFallback')),
      })}{' '}
      <Button variant="ghost" onClick={tentarDeNovo}>
        {t('resolvedBindings.retry')}
      </Button>
    </div>
  );
}

/** O lugar da cadeia numa linha que ainda não tem resposta, ou cuja leitura falhou. */
export function MarcaDeBindingNaoLido({ falhou }: { falhou: boolean }) {
  const { t } = useTranslation('settings');
  return (
    <Badge square tone="muted">
      {falhou ? t('resolvedBindings.cellUnread') : t('resolvedBindings.cellLoading')}
    </Badge>
  );
}

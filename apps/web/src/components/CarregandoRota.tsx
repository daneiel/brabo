import { useTranslation } from 'react-i18next';
import { Skeleton } from './ui/Skeleton';

/**
 * O fallback de rota enquanto o chunk da tela ainda não chegou (AT-300).
 *
 * O router ESPERA o chunk antes de trocar de tela (`lazyRouteComponent` +
 * `.preload`), então isto só aparece quando o download demora — e aí diz o que
 * está acontecendo em TEXTO, com `role="status"`, em vez de um vazio. Os
 * esqueletos são decoração (`aria-hidden` no próprio `Skeleton`): a informação
 * é a frase.
 */
export function CarregandoRota() {
  const { t } = useTranslation('common');
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="carregando-rota"
      style={{ display: 'grid', gap: 12, padding: 24 }}
    >
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t('route.loading')}</p>
      <Skeleton width="40%" height={28} />
      <Skeleton height={16} />
      <Skeleton width="80%" height={16} />
    </div>
  );
}

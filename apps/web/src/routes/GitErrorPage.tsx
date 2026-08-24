import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { AlertIcon } from '../components/ui/icons';

interface GitErrorPageProps {
  provider?: string;
}

export function GitErrorPage({ provider }: GitErrorPageProps) {
  const { t } = useTranslation('dashboard');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        height: '100%',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <span style={{ color: 'var(--danger)' }}>
        <AlertIcon size={32} />
      </span>
      <h2>{t('gitError.title')}</h2>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
        {provider
          ? t('gitError.bodyWithProvider', { provider })
          : t('gitError.bodyWithoutProvider')}
      </p>
      <Link to="/">
        <Button variant="secondary">{t('gitError.backToProjects')}</Button>
      </Link>
    </div>
  );
}

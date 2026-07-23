import { Link } from '@tanstack/react-router';
import { Button } from '../components/ui/Button';
import { AlertIcon } from '../components/ui/icons';

interface GitErrorPageProps {
  provider?: string;
}

export function GitErrorPage({ provider }: GitErrorPageProps) {
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
      <h2>Não foi possível provisionar o repositório</h2>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 420 }}>
        O projeto foi criado, mas o provisionamento do repositório
        {provider ? ` via ${provider}` : ''} falhou. Verifique as credenciais do provider em
        Configurações e tente provisionar novamente.
      </p>
      <Link to="/">
        <Button variant="secondary">Voltar para projetos</Button>
      </Link>
    </div>
  );
}

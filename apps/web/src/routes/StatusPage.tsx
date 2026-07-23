import { useQuery } from '@tanstack/react-query';
import type { HealthStatus } from '@brabo/shared';
import { API_URL, ENGINE_URL, fetchHealth } from '../lib/health';

function StatusRow({
  label,
  query,
}: {
  label: string;
  query: ReturnType<typeof useHealthQuery>;
}) {
  const { data, isLoading, isError } = query;
  const status: HealthStatus['status'] | 'checking' = isLoading
    ? 'checking'
    : isError
      ? 'error'
      : (data?.status ?? 'error');

  const statusColor: Record<typeof status, string> = {
    ok: 'var(--success)',
    error: 'var(--danger)',
    checking: 'var(--text-muted)',
  };

  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>{label}</td>
      <td
        style={{
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--font-mono)',
          color: statusColor[status],
        }}
      >
        {status}
      </td>
      <td
        style={{
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          fontSize: '0.85em',
        }}
      >
        {data?.timestamp ?? '—'}
      </td>
    </tr>
  );
}

function useHealthQuery(name: string, baseUrl: string) {
  return useQuery({
    queryKey: ['health', name],
    queryFn: () => fetchHealth(baseUrl),
    refetchInterval: 5000,
    retry: false,
  });
}

export function StatusPage() {
  const apiHealth = useHealthQuery('api', API_URL);
  const engineHealth = useHealthQuery('engine', ENGINE_URL);

  return (
    <main
      style={{
        padding: 'var(--space-5)',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 'var(--space-4)' }}>
        Brabo — status da plataforma
      </h1>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          background: 'var(--surface-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        <thead>
          <tr
            style={{
              background: 'var(--surface-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              textAlign: 'left',
            }}
          >
            <th style={{ padding: 'var(--space-2) var(--space-3)' }}>
              Serviço
            </th>
            <th style={{ padding: 'var(--space-2) var(--space-3)' }}>
              Status
            </th>
            <th style={{ padding: 'var(--space-2) var(--space-3)' }}>
              Último check
            </th>
          </tr>
        </thead>
        <tbody>
          <StatusRow label="api (NestJS)" query={apiHealth} />
          <StatusRow label="engine (Elixir/Phoenix)" query={engineHealth} />
        </tbody>
      </table>
    </main>
  );
}

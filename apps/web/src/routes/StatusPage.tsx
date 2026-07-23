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

  return (
    <tr>
      <td>{label}</td>
      <td data-status={status}>{status}</td>
      <td>{data?.timestamp ?? '—'}</td>
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
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Brabo — status da plataforma</h1>
      <table cellPadding={8}>
        <thead>
          <tr>
            <th>Serviço</th>
            <th>Status</th>
            <th>Último check</th>
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

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { HealthStatus } from '@brabo/shared';
import { API_URL, ENGINE_URL, fetchHealth } from '../lib/health';
import { pollQueParaNoErro } from '../lib/query-policy';
import { Button } from '../components/ui/Button';

/**
 * O instante do `/health` na língua de quem lê (AT-327): antes a coluna
 * mostrava o ISO cru ("2026-09-30T04:23:31.743Z"). Valor que não é data
 * válida não vira "Invalid Date": devolve `null`, e a célula diz que o
 * serviço não informou.
 */
function formatarInstanteDoStatus(iso: string | undefined, idioma: string): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString(idioma, { dateStyle: 'short', timeStyle: 'medium' });
}

function StatusRow({
  label,
  query,
}: {
  label: string;
  query: ReturnType<typeof useHealthQuery>;
}) {
  const { t, i18n } = useTranslation('dashboard');
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
        {t(`status.state.${status}`)}
      </td>
      <td
        style={{
          padding: 'var(--space-2) var(--space-3)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          fontSize: '0.85em',
        }}
      >
        {isLoading
          ? '…'
          : (formatarInstanteDoStatus(data?.timestamp, i18n.language) ?? t('status.noTimestamp'))}
      </td>
    </tr>
  );
}

function useHealthQuery(name: string, baseUrl: string) {
  return useQuery({
    queryKey: ['health', name],
    queryFn: () => fetchHealth(baseUrl),
    // AT-302: o poll PARA no erro, como toda query da app — sem isso, um
    // serviço fora virava uma requisição a cada 5 s para sempre. A página
    // volta a perguntar no foco da janela e na remontagem, e o primeiro
    // sucesso retoma o ritmo sozinho.
    refetchInterval: pollQueParaNoErro(5000),
    retry: false,
  });
}

/**
 * Status da plataforma — rota PÚBLICA desde o ADR 0036.
 *
 * Saiu de trás do guard de sessão porque o rodapé das telas de auth aponta para
 * cá: protegida, ela redirecionava de volta para o login. Só consulta os
 * `/health` da api e do engine, que já eram públicos.
 *
 * Quem decide o destino do "voltar" é o router, não esta página: com sessão o
 * lugar certo é o dashboard, sem sessão é o login. A página não precisa saber a
 * diferença — e não precisa importar o módulo de auth para descobrir.
 */
export function StatusPage({
  irPara,
  voltarPara,
}: {
  irPara: (rota: string) => void;
  voltarPara: string;
}) {
  const { t } = useTranslation('dashboard');
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
        {t('status.heading')}
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
              {t('status.columns.service')}
            </th>
            <th style={{ padding: 'var(--space-2) var(--space-3)' }}>
              {t('status.columns.status')}
            </th>
            <th style={{ padding: 'var(--space-2) var(--space-3)' }}>
              {t('status.columns.lastCheck')}
            </th>
          </tr>
        </thead>
        <tbody>
          <StatusRow label={t('status.services.api')} query={apiHealth} />
          <StatusRow label={t('status.services.engine')} query={engineHealth} />
        </tbody>
      </table>
      <p style={{ marginTop: 'var(--space-4)' }}>
        {/* AT-327: um botão de verdade, não um link de 33×20 px. */}
        <Button variant="secondary" onClick={() => irPara(voltarPara)}>
          {t('status.back')}
        </Button>
      </p>
    </main>
  );
}

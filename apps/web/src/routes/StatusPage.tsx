import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Server, Cog } from 'lucide-react';
import type { HealthStatus } from '@brabo/shared';
import { API_URL, ENGINE_URL, fetchHealth } from '../lib/health';
import { pollQueParaNoErro } from '../lib/query-policy';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, type TableColumn } from '../components/ui/Table';

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

interface LinhaDoStatus {
  chave: string;
  icone: ReactNode;
  label: string;
  query: ReturnType<typeof useHealthQuery>;
}

function EstadoDoServico({ query }: { query: LinhaDoStatus['query'] }) {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, isError } = query;
  const status: HealthStatus['status'] | 'checking' = isLoading
    ? 'checking'
    : isError
      ? 'error'
      : (data?.status ?? 'error');
  return (
    <Badge tone={status === 'ok' ? 'success' : status === 'error' ? 'danger' : 'muted'}>
      {t(`status.state.${status}`)}
    </Badge>
  );
}

function UltimaChecagem({ query }: { query: LinhaDoStatus['query'] }) {
  const { t, i18n } = useTranslation('dashboard');
  const { data, isLoading } = query;
  if (isLoading) return <>…</>;
  return <>{formatarInstanteDoStatus(data?.timestamp, i18n.language) ?? t('status.noTimestamp')}</>;
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
  const linhas: LinhaDoStatus[] = [
    { chave: 'api', icone: <Server size={16} />, label: t('status.services.api'), query: apiHealth },
    { chave: 'engine', icone: <Cog size={16} />, label: t('status.services.engine'), query: engineHealth },
  ];
  const colunas: TableColumn<LinhaDoStatus>[] = [
    {
      key: 'servico',
      label: t('status.columns.service'),
      render: (l) => (
        <>
          <span aria-hidden="true">{l.icone}</span> {l.label}
        </>
      ),
    },
    { key: 'estado', label: t('status.columns.status'), render: (l) => <EstadoDoServico query={l.query} /> },
    { key: 'checagem', label: t('status.columns.lastCheck'), render: (l) => <UltimaChecagem query={l.query} /> },
  ];

  return (
    <main
      style={{
        padding: 'var(--space-5) var(--space-4)',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 'var(--space-4)' }}>
        {t('status.heading')}
      </h1>
      {/* AT-330 (achado N5): em 390px esta era a única página que rolava de
          lado — a tabela empurrava 413px. A rolagem horizontal, se ainda for
          preciso, fica DENTRO deste invólucro, nunca na página; e as células
          quebram texto longo em vez de alargar a coluna. */}
      <div
        data-testid="rolagem-da-tabela-de-status"
        style={{ maxWidth: '100%', overflowX: 'auto', overflowWrap: 'anywhere' }}
      >
        <Table
          columns={colunas}
          rows={linhas}
          rowKey={(l) => l.chave}
        />
      </div>
      <p style={{ marginTop: 'var(--space-4)' }}>
        {/* AT-327: um botão de verdade, não um link de 33×20 px. */}
        <Button variant="secondary" legenda={t('status.back')} onClick={() => irPara(voltarPara)}>
          <ArrowLeft aria-hidden="true" />
        </Button>
      </p>
    </main>
  );
}

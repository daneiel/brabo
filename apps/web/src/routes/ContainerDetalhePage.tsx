import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getRunInstructions } from '../lib/api-client';
import { INTERVALO_DO_PROJETO_MS } from '../lib/canal-vivo';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import { useContainersOverview, useCurrentWorkspaceWithRole } from '../lib/hooks';
import { AcoesDoContainer, EstadoObservadoCelula, TOM_DO_STATUS } from '../components/AcoesDoContainer';
import { chaveDasInstrucoesDeExecucao, urlLocalSegura } from '../components/RodarNaSuaMaquina';
import { RedeDoContainer } from '../components/RedeDoContainer';
import { Badge } from '../components/ui/Badge';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import styles from './ContainersPage.module.css';

/**
 * Detalhe de UM container (`/containers/$projectId`, AT-609, RN-925). Só
 * leituras que já existem: a linha da visão geral (registrado e observado
 * SEPARADOS, RN-486) e as URLs que a Infra DECLAROU — declaradas, nunca
 * verificadas (RN-855).
 */
export function ContainerDetalhePage() {
  const { t, i18n } = useTranslation('containers');
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { data: atual } = useCurrentWorkspaceWithRole();
  // Ritmo de projeto, não os 5s da lista (RN-579/RN-632).
  const query = useContainersOverview(atual?.workspace.id, INTERVALO_DO_PROJETO_MS);
  const run = useQuery({
    queryKey: chaveDasInstrucoesDeExecucao(projectId),
    queryFn: () => getRunInstructions(projectId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const item = query.data?.find((i) => i.projectId === projectId);
  const r = item?.registrado ?? null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link to="/containers" className={styles.projectLink}>
          {t('detail.back')}
        </Link>
        <h1 className={styles.title}>{item?.projectName ?? t('detail.title')}</h1>
      </div>

      {query.isError && (
        <ErroDeCarregamento
          titulo={t('loadError')}
          erro={query.error}
          onTentarDeNovo={() => void query.refetch()}
        />
      )}
      {!query.isError && query.isPending && <p className={styles.loading}>{t('loading')}</p>}
      {!query.isError && !query.isPending && !item && (
        <p className={styles.semRegistro}>{t('detail.notFound')}</p>
      )}

      {item && (
        <>
          <dl data-testid="container-detalhe" className={styles.subtitle}>
            <dt>{t('table.registered')}</dt>
            <dd>
              {r ? (
                <Badge tone={TOM_DO_STATUS[r.status]} emCurso={r.status === 'provisioning'}>
                  {t(`status.${r.status}`)}
                </Badge>
              ) : (
                <span className={styles.semRegistro}>{t('status.nuncaProvisionado')}</span>
              )}
            </dd>
            <dt>{t('table.observed')}</dt>
            <dd>
              <EstadoObservadoCelula item={item} />
            </dd>
            <dt>{t('table.image')}</dt>
            <dd>
              {r ? `${r.imagem ?? t('table.imageUnresolved')} · v${r.imageVersion}` : t('table.imageUndecided')}
            </dd>
            <dt>{t('table.resources')}</dt>
            <dd>
              {r
                ? t('table.resourcesValue', {
                    cpus: r.resources.cpus,
                    memoryMb: r.resources.memoryMb,
                    pidsLimit: r.resources.pidsLimit,
                  })
                : t('table.resourcesNone')}
            </dd>
            <dt>{t('detail.network')}</dt>
            <dd>
              {item.decisaoVigente
                ? t(`detail.networkValue.${item.decisaoVigente.network}`)
                : t('detail.networkNone')}
            </dd>
            <dt>{t('detail.mode')}</dt>
            <dd>{item.executionMode}</dd>
            {r && (
              <>
                <dt>{t('table.since')}</dt>
                <dd>{new Date(r.statusChangedAt).toLocaleString(i18n.language)}</dd>
              </>
            )}
          </dl>

          <section aria-label={t('detail.urls')}>
            <h2 className={styles.subtitle}>{t('detail.urls')}</h2>
            {run.isPending ? (
              <p className={styles.loading}>{t('loading')}</p>
            ) : run.data && run.data.urls.length > 0 ? (
              <>
                <ul>
                  {run.data.urls.map((u) => (
                    <li key={u.url}>
                      {u.label}{' '}
                      {urlLocalSegura(u.url) ? (
                        <a href={u.url} target="_blank" rel="noopener noreferrer">
                          {u.url}
                        </a>
                      ) : (
                        <span className={styles.motivo}>{t('detail.urlRecusada')}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className={styles.motivo}>{t('detail.urlsNote')}</p>
              </>
            ) : (
              <p className={styles.semRegistro}>{t('detail.urlsNone')}</p>
            )}
          </section>

          <RedeDoContainer item={item} papel={atual?.role} />

          <AcoesDoContainer item={item} papel={atual?.role} />
        </>
      )}
    </div>
  );
}

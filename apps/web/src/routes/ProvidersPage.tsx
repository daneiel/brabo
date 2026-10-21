import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { listProviderCapabilities } from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { roleAtLeast } from '../lib/roles';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import { CredentialsSection } from './settings/CredentialsSection';
import { ModelCatalogSection } from '../components/ModelCatalogSection';
import { CredentialSpendSection } from '../components/CredentialSpendSection';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import styles from './ProvidersPage.module.css';

/**
 * Página global dos providers (AT-577). Só COMPÕE as seções que já moram em
 * Configurações do projeto — mesmos endpoints e `queryKey`s, nenhuma escrita nova.
 */
export function ProvidersPage() {
  const { t } = useTranslation('providers');
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const capacidades = useQuery({
    queryKey: ['provider-capabilities'],
    queryFn: listProviderCapabilities,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const workspaceId = comPapel?.workspace.id;
  // Mesma régua de `GastoDasChaves`: a rota do relatório exige `owner` (RN-060).
  const ehOwner = roleAtLeast(comPapel?.role, 'owner');
  // Itera as CHAVES da resposta: capability nova aparece sem tocar aqui.
  const colunas = capacidades.data?.[0] ? Object.keys(capacidades.data[0].capabilities) : [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>{t('subtitle')}</p>
      </header>

      <CredentialsSection />

      <section className={styles.section} aria-labelledby="providers-capabilities">
        <h2 id="providers-capabilities" className={styles.sectionTitle}>
          {t('capabilities.title')}
        </h2>
        <p className={styles.note}>{t('capabilities.note')}</p>
        {capacidades.isError && (
          <ErroDeCarregamento
            titulo={t('capabilities.loadError')}
            erro={capacidades.error}
            onTentarDeNovo={() => void capacidades.refetch()}
          />
        )}
        {capacidades.data && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('capabilities.provider')}</th>
                {colunas.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capacidades.data.map((p) => (
                <tr key={p.provider}>
                  <th scope="row">{p.provider}</th>
                  {colunas.map((c) => (
                    <td key={c}>
                      {(p.capabilities as unknown as Record<string, unknown>)[c] === true
                        ? t('capabilities.proven')
                        : t('capabilities.notProven')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={styles.note}>{t('routing')}</p>
      </section>

      {workspaceId && <ModelCatalogSection workspaceId={workspaceId} />}
      {workspaceId && ehOwner && <CredentialSpendSection workspaceId={workspaceId} />}
    </div>
  );
}

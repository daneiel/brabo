import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { listProviderCapabilities } from '../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../lib/query-policy';
import { Badge } from '../components/ui/Badge';
import { COR_DO_PROVIDER, ROTULO_DO_PROVIDER, providerAtivo } from '../lib/models';
import { useProvidersComChave } from '../lib/providers-com-chave';
import type { LLMProviderName } from '../lib/api-types';
import { CredentialsSection } from './settings/CredentialsSection';
import { ModelCatalogSection } from '../components/ModelCatalogSection';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import type { CSSProperties } from 'react';
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
  // Itera as CHAVES da resposta: capability nova aparece sem tocar aqui.
  const comChave = useProvidersComChave(workspaceId);
  const todos = capacidades.data ?? [];
  const ativos = todos.filter((p) => providerAtivo(p.provider as LLMProviderName, comChave));
  const deFora = todos.filter((p) => !ativos.includes(p));
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
          <>
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
              {ativos.map((p) => (
                <tr key={p.provider}>
                  <th scope="row">
                    <span
                      className={styles.provider}
                      style={{ '--cor-do-provider': COR_DO_PROVIDER[p.provider as LLMProviderName] } as CSSProperties}
                    >
                      {ROTULO_DO_PROVIDER[p.provider as LLMProviderName] ?? p.provider}
                    </span>
                  </th>
                  {colunas.map((c) => (
                    <td key={c}>
                      {(p.capabilities as unknown as Record<string, unknown>)[c] === true ? (
                        <Badge tone="success">{t('capabilities.proven')}</Badge>
                      ) : (
                        <Badge tone="muted">{t('capabilities.notProven')}</Badge>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {deFora.length > 0 && (
            <p className={styles.note}>
              {t('capabilities.outside', {
                count: deFora.length,
                names: deFora.map((p) => ROTULO_DO_PROVIDER[p.provider as LLMProviderName] ?? p.provider).join(', '),
              })}
            </p>
          )}
          </>
        )}
        <p className={styles.note}>{t('routing')}</p>
      </section>

      {workspaceId && <ModelCatalogSection workspaceId={workspaceId} />}
    </div>
  );
}

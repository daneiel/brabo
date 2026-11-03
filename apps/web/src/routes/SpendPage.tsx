import { useTranslation } from 'react-i18next';
import { Shimmer } from '../components/ui/Shimmer';
import { RotateCcw } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { roleAtLeast } from '../lib/roles';
import {
  GastoDoWorkspace,
  MeuConsumoNoWorkspace,
  OrcamentosDosProjetos,
} from '../components/SpendPaineis';
import { CabecalhoDePagina } from '../components/shadcn/cabecalho-de-pagina';
import styles from './ProjectSpendTab.module.css';
import pagina from './SpendPage.module.css';

/**
 * A página GLOBAL de gastos (AT-632, ADR 0233): o owner vê o workspace inteiro
 * (e a fatura por chave, RN-060); quem não é owner vê o PRÓPRIO consumo por
 * projeto (RN-953). Papel desconhecido não pergunta nada (RN-088).
 */
export function SpendPage() {
  const { t } = useTranslation('spend');
  const papel = useCurrentWorkspaceWithRole();
  const workspaceId = papel.data?.workspace.id;

  return (
    <div className={pagina.page}>
      <CabecalhoDePagina titulo={t('global.title')} />
      {papel.isLoading && (
        <div className={styles.estado}>
          <Shimmer>{t('shared.loading')}</Shimmer>
        </div>
      )}
      {papel.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{t('role.error')}</span>
          <Button variant="ghost" legenda={t('shared.retry')} onClick={() => papel.refetch()}>
            <RotateCcw aria-hidden="true" />
          </Button>
        </div>
      )}
      {papel.data &&
        workspaceId &&
        (roleAtLeast(papel.data.role, 'owner') ? (
          <>
            <GastoDoWorkspace workspaceId={workspaceId} />
            <OrcamentosDosProjetos workspaceId={workspaceId} />
          </>
        ) : (
          <MeuConsumoNoWorkspace workspaceId={workspaceId} />
        ))}
    </div>
  );
}

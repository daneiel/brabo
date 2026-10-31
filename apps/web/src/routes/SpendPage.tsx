import { useTranslation } from 'react-i18next';
import { Shimmer } from '../components/ui/Shimmer';
import { useCurrentWorkspaceWithRole } from '../lib/hooks';
import { roleAtLeast } from '../lib/roles';
import {
  GastoDoWorkspace,
  MeuConsumoNoWorkspace,
  OrcamentosDosProjetos,
} from '../components/SpendPaineis';
import styles from './ProjectSpendTab.module.css';

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
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>{t('global.title')}</h1>
      {papel.isLoading && (
        <div className={styles.estado}>
          <Shimmer>{t('shared.loading')}</Shimmer>
        </div>
      )}
      {papel.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{t('role.error')}</span>
          <button type="button" className={styles.botao} onClick={() => papel.refetch()}>
            {t('shared.retry')}
          </button>
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

import { useTranslation } from 'react-i18next';
import { ROLE_ORDER } from '../../lib/roles';
import type { Role } from '../../lib/api-types';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

// `key` resolve para `matrix.rows.<key>` — a tradução é resolvida por quem
// consome (`MatrixSection`), como o padrão pede para dado não-React.
const MATRIX_ROWS: { key: string; minRole: Role }[] = [
  { key: 'mergeOpenPr', minRole: 'maintainer' },
  { key: 'deployProduction', minRole: 'maintainer' },
  { key: 'privilegedCommand', minRole: 'developer' },
  { key: 'schemaMigration', minRole: 'developer' },
  { key: 'editPermissions', minRole: 'maintainer' },
];

export function MatrixSection() {
  const { t } = useTranslation('settings');
  return (
    <SecaoDeConfiguracoes chave="approval-matrix">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('matrix.title')}</h2>
        <span className={styles.eyebrow}>{t('matrix.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>{t('matrix.subtitle')}</p>
      <div className={styles.matrixWrap}>
        <table className={styles.matrixTable}>
          <thead>
            <tr>
              <th>{t('matrix.columns.action')}</th>
              <th>owner</th>
              <th>maintainer</th>
              <th>developer</th>
              <th>viewer</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX_ROWS.map((row) => (
              <tr key={row.key}>
                <td>{t(`matrix.rows.${row.key}`)}</td>
                {(['owner', 'maintainer', 'developer', 'viewer'] as Role[]).map((role) => (
                  <td key={role}>
                    {ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(row.minRole) ? (
                      <span className={styles.check}>✓</span>
                    ) : (
                      <span className={styles.dash}>—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* A legenda do desenho: sem ela, ✓ e — são dois símbolos sem contrato. */}
      <div className={styles.matrixLegenda}>
        <span className={styles.matrixLegendaItem}>
          <span className={styles.check}>✓</span> {t('matrix.legend.canApprove')}
        </span>
        <span className={styles.matrixLegendaItem}>
          <span className={styles.dash}>—</span> {t('matrix.legend.noPermission')}
        </span>
      </div>
    </SecaoDeConfiguracoes>
  );
}

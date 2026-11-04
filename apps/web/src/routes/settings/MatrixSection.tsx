import { useTranslation } from 'react-i18next';
import { Grid3x3 } from 'lucide-react';
import { Ajuda } from '@/components/ui/Ajuda';
import { ROLE_ORDER } from '../../lib/roles';
import type { Role } from '../../lib/api-types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/shadcn/table';
import styles from '../ProjectSettingsTab.module.css';

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
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}><Grid3x3 aria-hidden="true" className={styles.tituloIcone} />{t('matrix.title')}</h2>
        <Ajuda assunto={t('matrix.title')}>{t('matrix.subtitle')}</Ajuda>
        <span className={styles.eyebrow}>{t('matrix.eyebrow')}</span>
      </div>
      <div className={styles.matrixWrap}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('matrix.columns.action')}</TableHead>
              <TableHead className={styles.matrixCol}>owner</TableHead>
              <TableHead className={styles.matrixCol}>maintainer</TableHead>
              <TableHead className={styles.matrixCol}>developer</TableHead>
              <TableHead className={styles.matrixCol}>viewer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MATRIX_ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{t(`matrix.rows.${row.key}`)}</TableCell>
                {(['owner', 'maintainer', 'developer', 'viewer'] as Role[]).map((role) => (
                  <TableCell key={role}>
                    {ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(row.minRole) ? (
                      <span className={styles.check}>✓</span>
                    ) : (
                      <span className={styles.dash}>—</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
    </section>
  );
}

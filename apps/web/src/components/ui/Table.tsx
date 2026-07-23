import type { ReactNode } from 'react';
import styles from './Table.module.css';

export interface TableColumn<T> {
  key: string;
  label: string;
  width?: string;
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

export function Table<T>({ columns, rows, rowKey, emptyMessage = 'Nada por aqui ainda.' }: TableProps<T>) {
  const gridTemplateColumns = columns.map((c) => c.width ?? '1fr').join(' ');

  return (
    <div className={styles.table}>
      <div className={styles.header}>
        <div className={styles.row} style={{ gridTemplateColumns }}>
          {columns.map((column) => (
            <div key={column.key} className={styles.cell}>
              {column.label}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.body}>
        {rows.length === 0 && <div className={styles.empty}>{emptyMessage}</div>}
        {rows.map((row) => (
          <div key={rowKey(row)} className={styles.row} style={{ gridTemplateColumns }}>
            {columns.map((column) => (
              <div key={column.key} className={styles.cell}>
                {column.render(row)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

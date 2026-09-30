import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutMovel } from '../../lib/layout-movel';
import styles from './Table.module.css';

export interface TableColumn<T> {
  key: string;
  label: string;
  width?: string;
  /** No layout móvel (cartão empilhado), o rótulo vai ACIMA do valor e o valor
   *  ocupa a largura inteira do cartão — para o que não cabe ao lado de um
   *  rótulo em 390px (um seletor, um bloco de ações). */
  largaNoMovel?: boolean;
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

export function Table<T>({ columns, rows, rowKey, emptyMessage }: TableProps<T>) {
  const { t } = useTranslation('ui');
  const mensagemVazia = emptyMessage ?? t('table.emptyMessage');
  const gridTemplateColumns = columns.map((c) => c.width ?? '1fr').join(' ');
  const movel = useLayoutMovel();

  // Layout móvel (AT-330, RN-643): N colunas em fração não cabem em 390px —
  // o `/containers` espremia sete, os cabeçalhos se sobrepunham e as ações
  // saíam pela direita; em "Modelos por agente" o nome do agente ficava com
  // 6px e o seletor com 0px. Abaixo do breakpoint cada linha vira um CARTÃO
  // empilhado, e cada célula leva o rótulo da coluna ao lado do valor — o
  // cabeçalho some porque não há mais coluna para ele encabeçar. Coluna sem
  // rótulo (a das ações, em várias telas) ou marcada `largaNoMovel` ocupa a
  // largura inteira do cartão, com o rótulo em cima.
  if (movel) {
    return (
      <div className={[styles.table, styles.pilha].join(' ')} data-layout="pilha">
        {rows.length === 0 && <div className={styles.empty}>{mensagemVazia}</div>}
        {rows.map((row) => (
          <div key={rowKey(row)} className={styles.cartao} data-testid="linha-da-tabela">
            {columns.map((column) => (
              <div
                key={column.key}
                data-campo={column.key}
                data-largo={!column.label || column.largaNoMovel ? '' : undefined}
                className={[
                  styles.campo,
                  (!column.label || column.largaNoMovel) && styles.campoLargo,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {column.label && <span className={styles.campoRotulo}>{column.label}</span>}
                <div className={styles.campoValor}>{column.render(row)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

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
        {rows.length === 0 && <div className={styles.empty}>{mensagemVazia}</div>}
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

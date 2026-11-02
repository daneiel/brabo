import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutMovel } from '../../lib/layout-movel';
import {
  Grade,
  GradeCabecalho,
  GradeCampo,
  GradeCartao,
  GradeCelula,
  GradeCorpo,
  GradeLinha,
  GradeRotulo,
  GradeValor,
  GradeVazia,
} from '@/components/shadcn/table';

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
      <Grade data-layout="pilha">
        {rows.length === 0 && <GradeVazia>{mensagemVazia}</GradeVazia>}
        {rows.map((row) => (
          <GradeCartao key={rowKey(row)} data-testid="linha-da-tabela">
            {columns.map((column) => (
              <GradeCampo
                key={column.key}
                data-campo={column.key}
                largo={!column.label || column.largaNoMovel}
              >
                {column.label && <GradeRotulo>{column.label}</GradeRotulo>}
                <GradeValor>{column.render(row)}</GradeValor>
              </GradeCampo>
            ))}
          </GradeCartao>
        ))}
      </Grade>
    );
  }

  return (
    <Grade>
      <GradeCabecalho>
        <GradeLinha style={{ gridTemplateColumns }}>
          {columns.map((column) => (
            <GradeCelula key={column.key} cabecalho>
              {column.label}
            </GradeCelula>
          ))}
        </GradeLinha>
      </GradeCabecalho>
      <GradeCorpo>
        {rows.length === 0 && <GradeVazia>{mensagemVazia}</GradeVazia>}
        {rows.map((row) => (
          <GradeLinha key={rowKey(row)} corpo style={{ gridTemplateColumns }}>
            {columns.map((column) => (
              <GradeCelula key={column.key}>{column.render(row)}</GradeCelula>
            ))}
          </GradeLinha>
        ))}
      </GradeCorpo>
    </Grade>
  );
}

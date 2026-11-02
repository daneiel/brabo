import { useTranslation } from 'react-i18next';
import type { PaginaDaFila } from '../lib/paginacao-de-fila';
import { Button } from './ui/Button';
import styles from './PendenciasDeOutrasSessoes.module.css';

/**
 * AT-680 (RN-975): o controle de página de UMA fila, no fim dela. Só existe com
 * mais de uma página (RN-178); o `aria-label` nomeia a fila (são até cinco
 * paginadores na tela) e a faixa "x–y de N" é o recorte declarado (RN-180).
 */
export function PaginadorDaFila({
  fila,
  pagina,
  aoMudar,
}: {
  fila: string;
  pagina: PaginaDaFila<unknown>;
  aoMudar: (nova: number) => void;
}) {
  const { t } = useTranslation('sessionPage');
  if (pagina.totalDePaginas <= 1) return null;
  return (
    <div className={styles.paginador}>
      <Button
        type="button"
        icon
        size="sm"
        variant="secondary"
        onClick={() => aoMudar(pagina.pagina - 1)}
        disabled={pagina.pagina === 0}
        aria-label={t('pendencias.paginacao.anterior', { fila })}
      >
        ‹
      </Button>
      <span role="status" className={styles.paginadorTexto}>
        {t('pendencias.paginacao.faixa', { inicio: pagina.inicio, fim: pagina.fim, total: pagina.total })}
      </span>
      <Button
        type="button"
        icon
        size="sm"
        variant="secondary"
        onClick={() => aoMudar(pagina.pagina + 1)}
        disabled={pagina.pagina >= pagina.totalDePaginas - 1}
        aria-label={t('pendencias.paginacao.proxima', { fila })}
      >
        ›
      </Button>
    </div>
  );
}

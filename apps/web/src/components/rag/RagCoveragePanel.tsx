import { useTranslation } from 'react-i18next';
import type { RagCoverage, RagFileCoverage } from '../../lib/api-types';
import { AlertIcon } from '../ui/icons';
import styles from './RagCoveragePanel.module.css';

function CartaoDeArquivos({ rotulo, cobertura }: { rotulo: string; cobertura: RagFileCoverage }) {
  const { t } = useTranslation('sessions');
  return (
    <div className={styles.cartao}>
      <div className={styles.cartaoRotulo}>{rotulo}</div>
      <div className={styles.cartaoValor}>
        {cobertura.filesIndexed}
        <span className={styles.cartaoTotal}> / {cobertura.filesInRepo}</span>
      </div>
      <div className={styles.cartaoNota}>
        {cobertura.filesInRepo === 0
          ? t('ragCoverage.noFilesInRepo')
          : t('ragCoverage.filesIndexed')}
        {cobertura.truncated && (
          <span className={styles.aviso}>
            {' · '}
            <AlertIcon size={11} /> {t('ragCoverage.truncated')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Cobertura do índice (RN-237, ADR 0080) — contagem REAL contra o total real,
 * nunca "reindexado há Xmin". `GetRagCoverageUseCase` não devolve nenhum
 * timestamp de indexação, porque a coluna não existe — e esta tela não
 * inventa um. `chunksWithoutVector` é histórico do que já foi gravado, não da
 * busca ATUAL: um chunk sem vetor continua achável só pelo sinal léxico até a
 * próxima reindexação com o provider de embedding no ar.
 */
export function RagCoveragePanel({ coverage }: { coverage: RagCoverage }) {
  const { t } = useTranslation('sessions');
  return (
    <div className={styles.painel}>
      <div className={styles.grade}>
        <CartaoDeArquivos rotulo={t('ragCoverage.docsLabel')} cobertura={coverage.docs} />
        <CartaoDeArquivos rotulo={t('ragCoverage.adrLabel')} cobertura={coverage.adr} />
        <div className={styles.cartao}>
          <div className={styles.cartaoRotulo}>{t('ragCoverage.sessionsLabel')}</div>
          <div className={styles.cartaoValor}>
            {coverage.session.sessionsIndexed}
            <span className={styles.cartaoTotal}> / {coverage.session.sessionsInProject}</span>
          </div>
          <div className={styles.cartaoNota}>
            {coverage.session.sessionsInProject === 0
              ? t('ragCoverage.noSessionsInProject')
              : t('ragCoverage.sessionsIndexed')}
          </div>
        </div>
      </div>
      <div className={styles.rodape}>
        {t('ragCoverage.chunksInIndex', { count: coverage.chunksTotal })}
        {coverage.chunksWithoutVector > 0 && (
          <>
            {' · '}
            {t('ragCoverage.chunksWithoutVector', { count: coverage.chunksWithoutVector })}
          </>
        )}
      </div>
    </div>
  );
}

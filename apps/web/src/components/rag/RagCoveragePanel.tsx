import type { RagCoverage, RagFileCoverage } from '../../lib/api-types';
import { AlertIcon } from '../ui/icons';
import styles from './RagCoveragePanel.module.css';

function CartaoDeArquivos({ rotulo, cobertura }: { rotulo: string; cobertura: RagFileCoverage }) {
  return (
    <div className={styles.cartao}>
      <div className={styles.cartaoRotulo}>{rotulo}</div>
      <div className={styles.cartaoValor}>
        {cobertura.filesIndexed}
        <span className={styles.cartaoTotal}> / {cobertura.filesInRepo}</span>
      </div>
      <div className={styles.cartaoNota}>
        {cobertura.filesInRepo === 0 ? 'nenhum arquivo no repositório' : 'arquivos indexados'}
        {cobertura.truncated && (
          <span className={styles.aviso}>
            {' · '}
            <AlertIcon size={11} /> contagem cortada pelo teto
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
  return (
    <div className={styles.painel}>
      <div className={styles.grade}>
        <CartaoDeArquivos rotulo="docs" cobertura={coverage.docs} />
        <CartaoDeArquivos rotulo="ADR" cobertura={coverage.adr} />
        <div className={styles.cartao}>
          <div className={styles.cartaoRotulo}>sessões</div>
          <div className={styles.cartaoValor}>
            {coverage.session.sessionsIndexed}
            <span className={styles.cartaoTotal}> / {coverage.session.sessionsInProject}</span>
          </div>
          <div className={styles.cartaoNota}>
            {coverage.session.sessionsInProject === 0 ? 'nenhuma sessão no projeto' : 'sessões indexadas'}
          </div>
        </div>
      </div>
      <div className={styles.rodape}>
        {coverage.chunksTotal} chunk(s) no índice
        {coverage.chunksWithoutVector > 0 && (
          <>
            {' · '}
            {coverage.chunksWithoutVector} sem vetor — indexado(s) só com o sinal léxico
          </>
        )}
      </div>
    </div>
  );
}

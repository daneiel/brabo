import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mensagemDaApi, searchCode } from '../../lib/api-client';
import styles from './CodeSearchPanel.module.css';

interface CodeSearchPanelProps {
  projectId: string;
  /** Não `ref`: reservado pelo React mesmo em componente de função. Ver CodeExplorer.tsx. */
  gitRef: string;
  onOpenFile: (path: string) => void;
}

/**
 * Busca — usa a rota real (`ReadProjectCodeUseCase.search`), que é composta e
 * orçada (item 34). Não busca a cada tecla: só ao SUBMETER, para não gastar o
 * orçamento da busca a cada caractere digitado.
 */
export function CodeSearchPanel({ projectId, gitRef, onOpenFile }: CodeSearchPanelProps) {
  const { t } = useTranslation('code');
  const [termo, setTermo] = useState('');
  const [buscado, setBuscado] = useState<string | null>(null);

  const searchQuery = useQuery({
    queryKey: ['code-search', projectId, gitRef, buscado],
    queryFn: () => searchCode(projectId, { q: buscado!, ref: gitRef }),
    enabled: Boolean(buscado && gitRef),
  });

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    const limpo = termo.trim();
    if (limpo.length >= 2) setBuscado(limpo);
  }

  return (
    <div className={styles.busca}>
      <div className={styles.cabecalho}>{t('search.title')}</div>

      <form className={styles.formulario} onSubmit={submeter}>
        <input
          className={styles.input}
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.ariaLabel')}
        />
        <button type="submit" className={styles.botao} disabled={!gitRef}>
          {t('search.button')}
        </button>
      </form>

      <div className={styles.resultados}>
        {!buscado && <div className={styles.estado}>{t('search.initial')}</div>}

        {buscado && searchQuery.isLoading && <div className={styles.estado}>{t('search.searching')}</div>}

        {buscado && searchQuery.isError && (
          <div className={styles.estadoErro} role="alert">
            <span>{mensagemDaApi(searchQuery.error, t('search.errorFallback'))}</span>
            <button type="button" className={styles.botaoTentar} onClick={() => void searchQuery.refetch()}>
              {t('shared.retry')}
            </button>
          </div>
        )}

        {buscado && searchQuery.data && searchQuery.data.matches.length === 0 && (
          <div className={styles.estado}>
            {t('search.noResults', { query: searchQuery.data.query })}
          </div>
        )}

        {buscado && searchQuery.data && searchQuery.data.matches.length > 0 && (
          <>
            <ul className={styles.lista}>
              {searchQuery.data.matches.map((m, i) => (
                <li key={`${m.path}:${m.line}:${i}`}>
                  <button
                    type="button"
                    className={styles.resultado}
                    onClick={() => onOpenFile(m.path)}
                    title={m.path}
                  >
                    <span className={styles.resultadoCaminho}>
                      {m.path}
                      <span className={styles.resultadoLinha}>:{m.line}</span>
                    </span>
                    <span className={styles.resultadoTrecho}>{m.text.trim()}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.rodape}>
              {t('search.filesScanned', { count: searchQuery.data.filesScanned })}
              {searchQuery.data.truncated && t('search.truncatedSuffix')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

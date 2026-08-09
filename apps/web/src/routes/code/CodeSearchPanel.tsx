import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
      <div className={styles.cabecalho}>Buscar</div>

      <form className={styles.formulario} onSubmit={submeter}>
        <input
          className={styles.input}
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Termo (mín. 2 caracteres)"
          aria-label="Termo de busca"
        />
        <button type="submit" className={styles.botao} disabled={!gitRef}>
          Buscar
        </button>
      </form>

      <div className={styles.resultados}>
        {!buscado && <div className={styles.estado}>Digite um termo e busque no conteúdo da ref atual.</div>}

        {buscado && searchQuery.isLoading && <div className={styles.estado}>Buscando…</div>}

        {buscado && searchQuery.isError && (
          <div className={styles.estadoErro} role="alert">
            <span>{mensagemDaApi(searchQuery.error, 'Não consegui buscar agora.')}</span>
            <button type="button" className={styles.botaoTentar} onClick={() => void searchQuery.refetch()}>
              Tentar de novo
            </button>
          </div>
        )}

        {buscado && searchQuery.data && searchQuery.data.matches.length === 0 && (
          <div className={styles.estado}>Nenhum resultado para “{searchQuery.data.query}”.</div>
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
              {searchQuery.data.filesScanned} arquivo(s) verificado(s)
              {searchQuery.data.truncated && ' · busca cortada pelo orçamento — refine o termo ou o caminho'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeTree, mensagemDaApi } from '../../lib/api-client';
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from '../../components/ui/icons';
import type { CodeTreeEntry } from '../../lib/api-types';
import styles from './CodeExplorer.module.css';

interface CodeExplorerProps {
  projectId: string;
  /**
   * Nome deliberadamente NÃO `ref`: essa palavra é reservada pelo React (até
   * pra componente de função, na FASE 26 do React 19) e um prop chamado assim
   * não chega normal em `props` — vira o mecanismo de ref de verdade, e um
   * valor STRING nele quebra em silêncio. `gitRef` em todo este diretório.
   */
  gitRef: string;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

/**
 * O explorador de arquivos — carrega por DIRETÓRIO (item 34 da FASE 26: a
 * árvore não é recursiva por desenho, para não virar amplificador de
 * tráfego). A raiz carrega ao montar; cada subpasta só chama a api quando o
 * usuário a abre.
 */
export function CodeExplorer({ projectId, gitRef, activePath, onOpenFile }: CodeExplorerProps) {
  const raizQuery = useQuery({
    queryKey: ['code-tree', projectId, gitRef, ''],
    queryFn: () => getCodeTree(projectId, { ref: gitRef, path: '' }),
    enabled: Boolean(gitRef),
  });

  return (
    <div className={styles.explorador}>
      <div className={styles.cabecalho}>Explorador</div>
      <div className={styles.arvore}>
        {!gitRef && <div className={styles.estado}>Sem branch para navegar.</div>}

        {gitRef && raizQuery.isLoading && <div className={styles.estado}>Carregando…</div>}

        {gitRef && raizQuery.isError && (
          <div className={styles.estadoErro} role="alert">
            <span>{mensagemDaApi(raizQuery.error, 'Não consegui listar a raiz do repositório.')}</span>
            <button type="button" className={styles.botaoTentar} onClick={() => void raizQuery.refetch()}>
              Tentar de novo
            </button>
          </div>
        )}

        {gitRef && raizQuery.data && raizQuery.data.entries.length === 0 && (
          <div className={styles.estado}>Repositório vazio nesta ref.</div>
        )}

        {gitRef && raizQuery.data && raizQuery.data.entries.length > 0 && (
          <ul className={styles.lista}>
            {ordenar(raizQuery.data.entries).map((entrada) => (
              <TreeEntry
                key={entrada.path}
                entrada={entrada}
                projectId={projectId}
                gitRef={gitRef}
                depth={0}
                activePath={activePath}
                onOpenFile={onOpenFile}
              />
            ))}
          </ul>
        )}

        {gitRef && raizQuery.data?.truncated && (
          <div className={styles.truncado}>
            A raiz tem mais entradas do que o teto por nível — refine navegando pelas pastas.
          </div>
        )}
      </div>
    </div>
  );
}

/** Pastas primeiro, depois arquivos — ambos alfabéticos. É só ordenação de exibição. */
function ordenar(entries: CodeTreeEntry[]): CodeTreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

interface TreeEntryProps {
  entrada: CodeTreeEntry;
  projectId: string;
  gitRef: string;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

function TreeEntry({ entrada, projectId, gitRef, depth, activePath, onOpenFile }: TreeEntryProps) {
  const [aberto, setAberto] = useState(false);
  const indentacao = 8 + depth * 13;

  const filhosQuery = useQuery({
    queryKey: ['code-tree', projectId, gitRef, entrada.path],
    queryFn: () => getCodeTree(projectId, { ref: gitRef, path: entrada.path }),
    enabled: entrada.type === 'dir' && aberto,
  });

  if (entrada.type === 'file') {
    const ativo = entrada.path === activePath;
    return (
      <li>
        <button
          type="button"
          className={[styles.linha, ativo && styles.linhaAtiva].filter(Boolean).join(' ')}
          style={{ paddingLeft: indentacao + 18 }}
          onClick={() => onOpenFile(entrada.path)}
          title={entrada.path}
        >
          <FileIcon size={13} />
          <span className={styles.nome}>{entrada.name}</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={styles.linha}
        style={{ paddingLeft: indentacao }}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        {aberto ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <FolderIcon size={13} />
        <span className={styles.nome}>{entrada.name}</span>
      </button>

      {aberto && (
        <ul className={styles.lista}>
          {filhosQuery.isLoading && (
            <li className={styles.estadoFilho} style={{ paddingLeft: indentacao + 18 }}>
              Carregando…
            </li>
          )}
          {filhosQuery.isError && (
            <li className={styles.estadoFilho} style={{ paddingLeft: indentacao + 18 }}>
              <span role="alert">
                {mensagemDaApi(filhosQuery.error, 'Não consegui listar esta pasta.')}
              </span>
            </li>
          )}
          {filhosQuery.data && filhosQuery.data.entries.length === 0 && (
            <li className={styles.estadoFilho} style={{ paddingLeft: indentacao + 18 }}>
              Pasta vazia.
            </li>
          )}
          {filhosQuery.data &&
            ordenar(filhosQuery.data.entries).map((filho) => (
              <TreeEntry
                key={filho.path}
                entrada={filho}
                projectId={projectId}
                gitRef={gitRef}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
              />
            ))}
          {filhosQuery.data?.truncated && (
            <li
              className={styles.truncadoFilho}
              style={{ paddingLeft: indentacao + 18 }}
            >
              Mais entradas do que o teto por nível.
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

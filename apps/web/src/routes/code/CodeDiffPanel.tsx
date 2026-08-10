import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeDiff, mensagemDaApi } from '../../lib/api-client';
import { Disclosure } from '../../components/ui/Disclosure';
import type { CodeDiffFile } from '../../lib/api-types';
import styles from './CodeDiffPanel.module.css';

const ROTULO_STATUS: Record<CodeDiffFile['status'], string> = {
  added: 'novo',
  modified: 'modificado',
  removed: 'removido',
  renamed: 'renomeado',
};

/**
 * Diff de uma PR, alcançado por ID CONHECIDO — não há lista de PRs AQUI ainda
 * (a fundação chegou na FASE 26b: `GET /projects/:id/code/pull-requests` via
 * `getCodePullRequests` em `api-client.ts`, resumo por PR com id/título/
 * autor/estado/branches. Esta tela ainda não a consome — trocar o campo de
 * id por uma lista clicável é da onda seguinte). Quem sabe o id cola aqui.
 */
export function CodeDiffPanel({ projectId }: { projectId: string }) {
  const [idDigitado, setIdDigitado] = useState('');
  const [prId, setPrId] = useState<string | null>(null);

  const diffQuery = useQuery({
    queryKey: ['code-diff', projectId, prId],
    queryFn: () => getCodeDiff(projectId, prId!),
    enabled: Boolean(prId),
  });

  return (
    <div className={styles.painel}>
      <form
        className={styles.formulario}
        onSubmit={(e) => {
          e.preventDefault();
          if (idDigitado.trim()) setPrId(idDigitado.trim());
        }}
      >
        <label className={styles.label} htmlFor="diff-pr-id">
          Id da PR
        </label>
        <input
          id="diff-pr-id"
          className={styles.input}
          value={idDigitado}
          onChange={(e) => setIdDigitado(e.target.value)}
          placeholder="ex.: 218, ou o id do provider"
        />
        <button type="submit" className={styles.botao}>
          Ver diff
        </button>
      </form>

      {!prId && (
        <div className={styles.estado}>
          Sem lista de PRs aqui — cole o id de uma PR conhecida (ela aparece em
          Aprovações) para ver o diff normalizado.
        </div>
      )}

      {prId && diffQuery.isLoading && <div className={styles.estado}>Carregando diff…</div>}

      {prId && diffQuery.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{mensagemDaApi(diffQuery.error, 'Não consegui carregar o diff desta PR.')}</span>
          <button type="button" className={styles.botaoTentar} onClick={() => void diffQuery.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}

      {prId && diffQuery.data && diffQuery.data.files.length === 0 && (
        <div className={styles.estado}>Esta PR não mudou nenhum arquivo.</div>
      )}

      {prId && diffQuery.data && diffQuery.data.files.length > 0 && (
        <div className={styles.lista}>
          {diffQuery.data.files.map((arquivo) => (
            <Disclosure
              key={`${arquivo.path}:${arquivo.status}`}
              titulo={
                <span className={styles.tituloArquivo}>
                  <span className={styles.caminho}>{arquivo.path}</span>
                  <span className={styles.selo}>{ROTULO_STATUS[arquivo.status]}</span>
                </span>
              }
              trailing={
                <span className={styles.contadores}>
                  <span className={styles.add}>+{arquivo.additions}</span>{' '}
                  <span className={styles.del}>−{arquivo.deletions}</span>
                </span>
              }
            >
              <ConteudoDoPatch arquivo={arquivo} />
            </Disclosure>
          ))}
          {diffQuery.data.truncated && (
            <div className={styles.truncado}>
              A lista de arquivos foi cortada no teto por PR.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConteudoDoPatch({ arquivo }: { arquivo: CodeDiffFile }) {
  // `null` é "o provider não entregou o texto" (binário, ou patch grande
  // demais) — distinto de `''`, que é "veio vazio" de verdade. Tratar os
  // dois igual faria a tela dizer "sem mudanças" num binário alterado.
  if (arquivo.patch === null) {
    return <div className={styles.semTexto}>Sem texto de diff disponível para este arquivo.</div>;
  }
  if (arquivo.patch === '') {
    return <div className={styles.semTexto}>Diff sem conteúdo de texto (ex.: só mudança de modo).</div>;
  }
  return (
    <pre className={styles.patch}>
      {arquivo.patch.split('\n').map((linha, i) => (
        <div
          key={i}
          className={[
            styles.linhaPatch,
            linha.startsWith('+') && !linha.startsWith('+++') && styles.linhaAdd,
            linha.startsWith('-') && !linha.startsWith('---') && styles.linhaDel,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {linha || ' '}
        </div>
      ))}
    </pre>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeDiff, getCodePullRequests, mensagemDaApi } from '../../lib/api-client';
import { Disclosure } from '../../components/ui/Disclosure';
import { ArrowLeftIcon, PrIcon } from '../../components/ui/icons';
import type { CodeDiffFile, CodePullRequestState, CodePullRequestSummary } from '../../lib/api-types';
import styles from './CodeDiffPanel.module.css';

const ROTULO_STATUS: Record<CodeDiffFile['status'], string> = {
  added: 'novo',
  modified: 'modificado',
  removed: 'removido',
  renamed: 'renomeado',
};

const ROTULO_ESTADO_PR: Record<CodePullRequestState, string> = {
  open: 'aberta',
  merged: 'mesclada',
  closed: 'fechada',
};

const FILTROS: Array<{ chave: CodePullRequestState | 'all'; rotulo: string }> = [
  { chave: 'open', rotulo: 'Abertas' },
  { chave: 'merged', rotulo: 'Mescladas' },
  { chave: 'closed', rotulo: 'Fechadas' },
  { chave: 'all', rotulo: 'Todas' },
];

/**
 * Painel de PRs: lista navegável (FASE seguinte à 26b) por cima do diff já
 * existente. `GET /projects/:id/code/pull-requests` via `getCodePullRequests`
 * resolve id/título/autor/estado/branches; clicar num item abre o mesmo fluxo
 * de diff por ID que já funcionava (`getCodeDiff`). Quem já sabe o id (ex.:
 * veio de Aprovações) pode colar direto, sem passar pela lista.
 */
export function CodeDiffPanel({ projectId }: { projectId: string }) {
  const [filtro, setFiltro] = useState<CodePullRequestState | 'all'>('open');
  const [idDigitado, setIdDigitado] = useState('');
  const [selecionada, setSelecionada] = useState<CodePullRequestSummary | null>(null);
  const [prIdManual, setPrIdManual] = useState<string | null>(null);

  const prId = selecionada?.id ?? prIdManual;

  const listaQuery = useQuery({
    queryKey: ['code-pull-requests', projectId, filtro],
    queryFn: () => getCodePullRequests(projectId, filtro === 'all' ? {} : { state: filtro }),
    enabled: !prId,
  });

  const diffQuery = useQuery({
    queryKey: ['code-diff', projectId, prId],
    queryFn: () => getCodeDiff(projectId, prId!),
    enabled: Boolean(prId),
  });

  function voltarParaLista() {
    setSelecionada(null);
    setPrIdManual(null);
    setIdDigitado('');
  }

  if (prId) {
    return (
      <div className={styles.painel}>
        <div className={styles.cabecalhoDiff}>
          <button type="button" className={styles.botaoVoltar} onClick={voltarParaLista}>
            <ArrowLeftIcon size={14} />
            Voltar à lista
          </button>
          {selecionada && (
            <span className={styles.tituloDiff}>
              <span className={styles.tituloDiffTexto}>
                #{selecionada.number} {selecionada.title}
              </span>
              <span className={styles.branches}>
                {selecionada.sourceBranch} → {selecionada.targetBranch}
              </span>
            </span>
          )}
        </div>

        {diffQuery.isLoading && <div className={styles.estado}>Carregando diff…</div>}

        {diffQuery.isError && (
          <div className={styles.estadoErro} role="alert">
            <span>{mensagemDaApi(diffQuery.error, 'Não consegui carregar o diff desta PR.')}</span>
            <button type="button" className={styles.botaoTentar} onClick={() => void diffQuery.refetch()}>
              Tentar de novo
            </button>
          </div>
        )}

        {diffQuery.data && diffQuery.data.files.length === 0 && (
          <div className={styles.estado}>Esta PR não mudou nenhum arquivo.</div>
        )}

        {diffQuery.data && diffQuery.data.files.length > 0 && (
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

  return (
    <div className={styles.painel}>
      <div className={styles.filtros} role="tablist" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            role="tab"
            aria-selected={filtro === f.chave}
            className={[styles.filtro, filtro === f.chave && styles.filtroAtivo].filter(Boolean).join(' ')}
            onClick={() => setFiltro(f.chave)}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {listaQuery.isLoading && <div className={styles.estado}>Carregando pull requests…</div>}

      {listaQuery.isError && (
        <div className={styles.estadoErro} role="alert">
          <span>{mensagemDaApi(listaQuery.error, 'Não consegui carregar a lista de PRs.')}</span>
          <button type="button" className={styles.botaoTentar} onClick={() => void listaQuery.refetch()}>
            Tentar de novo
          </button>
        </div>
      )}

      {listaQuery.data && listaQuery.data.items.length === 0 && (
        <div className={styles.estado}>
          Nenhuma PR {filtro !== 'all' ? ROTULO_ESTADO_PR[filtro] : ''} neste repositório.
        </div>
      )}

      {listaQuery.data && listaQuery.data.items.length > 0 && (
        <ul className={styles.listaPr}>
          {listaQuery.data.items.map((pr) => (
            <li key={pr.id}>
              <button
                type="button"
                className={styles.itemPr}
                aria-label={`Abrir PR #${pr.number}: ${pr.title}`}
                onClick={() => setSelecionada(pr)}
              >
                <PrIcon size={15} className={styles[`estadoIcone_${pr.state}`]} />
                <span className={styles.itemPrCorpo}>
                  <span className={styles.itemPrTitulo}>
                    #{pr.number} {pr.title}
                  </span>
                  <span className={styles.itemPrMeta}>
                    {pr.author ?? 'autor desconhecido'} · {pr.sourceBranch} → {pr.targetBranch}
                    {pr.updatedAt && ` · ${new Date(pr.updatedAt).toLocaleDateString('pt-BR')}`}
                  </span>
                </span>
                <span className={[styles.itemPrEstado, styles[`estadoSelo_${pr.state}`]].join(' ')}>
                  {ROTULO_ESTADO_PR[pr.state]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {listaQuery.data?.truncated && (
        <div className={styles.truncado}>A lista de PRs foi cortada no teto por chamada.</div>
      )}

      <form
        className={styles.formularioManual}
        onSubmit={(e) => {
          e.preventDefault();
          if (idDigitado.trim()) setPrIdManual(idDigitado.trim());
        }}
      >
        <label className={styles.label} htmlFor="diff-pr-id">
          Já sabe o id?
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

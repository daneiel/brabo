import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeBranches, mensagemDaApi } from '../../lib/api-client';
import type { CodeBranchDetail, CodePullRequestState } from '../../lib/api-types';
import { BranchIcon, CheckIcon, ChevronDownIcon } from '../../components/ui/icons';
import styles from './CodeBranchPicker.module.css';

const ROTULO_ESTADO_PR: Record<CodePullRequestState, string> = {
  open: 'aberta',
  merged: 'mesclada',
  closed: 'fechada',
};

interface CodeBranchPickerProps {
  projectId: string;
  /** Ref efetivamente aberta agora — branch, tag ou sha. */
  currentRef: string;
  onSelect: (ref: string) => void;
}

/**
 * Dropdown rico de branches (item 26b/33 do handoff — a fundação chegou na
 * FASE 26b em `getCodeBranches`, esta tela é quem passou a consumir).
 * Substitui o campo de texto simples: cada linha mostra nome, ahead/behind
 * relativo à branch default e a PR associada, quando houver. Uma ref fora da
 * lista (tag ou sha) continua alcançável pelo formulário no rodapé — a busca
 * de branches não enumera essas duas coisas.
 */
export function CodeBranchPicker({ projectId, currentRef, onSelect }: CodeBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [refManual, setRefManual] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const branchesQuery = useQuery({
    queryKey: ['code-branches', projectId],
    queryFn: () => getCodeBranches(projectId),
  });

  const branchAtual = branchesQuery.data?.items.find((b) => b.name === currentRef);

  // Fechar clicando fora e no Escape — mesmo padrão do ModelPicker.
  useEffect(() => {
    if (!open) return;

    function aoClicarFora(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function aoTeclar(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [open]);

  function escolher(nome: string) {
    onSelect(nome);
    setOpen(false);
  }

  function irParaRefManual(e: React.FormEvent) {
    e.preventDefault();
    const limpo = refManual.trim();
    if (!limpo) return;
    onSelect(limpo);
    setRefManual('');
    setOpen(false);
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={[styles.trigger, open && styles.triggerAberto].filter(Boolean).join(' ')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={currentRef || 'sem branch padrão'}
      >
        <BranchIcon size={13} />
        <span className={styles.triggerLabel}>{currentRef || 'sem branch padrão'}</span>
        {branchAtual && <MetaAheadBehind branch={branchAtual} />}
        <span className={styles.chevron}>
          <ChevronDownIcon size={12} />
        </span>
      </button>

      {open && (
        <div className={styles.dropdown} role="listbox" aria-label="Selecionar branch">
          <div className={styles.cabecalho}>
            {branchesQuery.data
              ? `${branchesQuery.data.items.length} branch(es) · comparadas com a default`
              : 'branches'}
          </div>

          {branchesQuery.isLoading && <div className={styles.estado}>Carregando branches…</div>}

          {branchesQuery.isError && (
            <div className={styles.estadoErro} role="alert">
              <span>{mensagemDaApi(branchesQuery.error, 'Não consegui carregar as branches.')}</span>
              <button
                type="button"
                className={styles.botaoTentar}
                onClick={() => void branchesQuery.refetch()}
              >
                Tentar de novo
              </button>
            </div>
          )}

          {branchesQuery.data && branchesQuery.data.items.length === 0 && (
            <div className={styles.estado}>Nenhuma branch encontrada neste repositório.</div>
          )}

          {branchesQuery.data && branchesQuery.data.items.length > 0 && (
            <ul className={styles.lista}>
              {branchesQuery.data.items.map((branch) => (
                <li key={branch.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={branch.name === currentRef}
                    className={[styles.opcao, branch.name === currentRef && styles.opcaoSelecionada]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => escolher(branch.name)}
                  >
                    <span
                      className={styles.ponto}
                      style={{ background: corDoPonto(branch, branch.name === currentRef) }}
                      aria-hidden="true"
                    />
                    <span className={styles.corpo}>
                      <span className={styles.nomeLinha}>
                        {branch.name === currentRef && (
                          <CheckIcon size={11} className={styles.check} />
                        )}
                        <span className={styles.nome}>{branch.name}</span>
                      </span>
                      <span className={styles.meta}>{metaDaBranch(branch, branch.name === currentRef)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {branchesQuery.data?.truncated && (
            <div className={styles.truncado}>A lista foi cortada no teto de branches enriquecidas.</div>
          )}

          <form className={styles.formManual} onSubmit={irParaRefManual}>
            <input
              className={styles.inputManual}
              value={refManual}
              onChange={(e) => setRefManual(e.target.value)}
              placeholder="ir para tag ou sha exato"
              aria-label="Ir para tag ou sha exato"
            />
            <button type="submit" className={styles.botaoIr} disabled={!refManual.trim()}>
              Ir
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function corDoPonto(branch: CodeBranchDetail, atual: boolean): string {
  if (atual) return 'var(--accent)';
  if (branch.pullRequest) return 'var(--violet)';
  return 'var(--success)';
}

function metaDaBranch(branch: CodeBranchDetail, atual: boolean): string {
  const partes: string[] = [];
  if (atual) partes.push('atual');
  if (branch.protected) partes.push('protegida');
  if (branch.pullRequest) {
    const { number, state } = branch.pullRequest;
    partes.push(
      state === 'open' ? `PR #${number}` : `PR #${number} (${ROTULO_ESTADO_PR[state]})`,
    );
  }
  const aheadBehind = formatarAheadBehind(branch);
  if (aheadBehind) partes.push(aheadBehind);
  return partes.join(' · ') || '—';
}

function formatarAheadBehind(branch: CodeBranchDetail): string | null {
  const { ahead, behind } = branch;
  if (ahead === null && behind === null) return null;
  const a = ahead ?? 0;
  const b = behind ?? 0;
  if (a === 0 && b === 0) return null;
  const partes: string[] = [];
  if (a > 0) partes.push(`↑${a}`);
  if (b > 0) partes.push(`↓${b}`);
  return partes.join(' ') || null;
}

function MetaAheadBehind({ branch }: { branch: CodeBranchDetail }) {
  const texto = formatarAheadBehind(branch);
  if (!texto) return null;
  return <span className={styles.triggerAheadBehind}>{texto}</span>;
}

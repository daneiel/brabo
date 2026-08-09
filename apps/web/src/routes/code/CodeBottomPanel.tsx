import { useState } from 'react';
import { TerminalIcon } from '../../components/ui/icons';
import { CodeDiffPanel } from './CodeDiffPanel';
import styles from './CodeBottomPanel.module.css';

type PainelInferior = 'terminal' | 'diff';

/**
 * Painel inferior: Terminal (estado vazio HONESTO — interativo é FASE 25b,
 * que ainda não subiu) e Diff (funcional, por id de PR conhecido).
 *
 * "Problemas" e "Saída" do handoff FICARAM DE FORA: não há integração de
 * lint/testes nem stream de comando algum — mostrar as abas vazias sem nada
 * atrás seria decoração, não estado.
 */
export function CodeBottomPanel({ projectId }: { projectId: string }) {
  const [aba, setAba] = useState<PainelInferior>('terminal');

  return (
    <div className={styles.painel}>
      <div className={styles.abas} role="tablist" aria-label="Painel inferior">
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'terminal'}
          className={[styles.aba, aba === 'terminal' && styles.abaAtiva].filter(Boolean).join(' ')}
          onClick={() => setAba('terminal')}
        >
          Terminal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'diff'}
          className={[styles.aba, aba === 'diff' && styles.abaAtiva].filter(Boolean).join(' ')}
          onClick={() => setAba('diff')}
        >
          Diff de PR
        </button>
      </div>

      <div className={styles.conteudo}>
        {aba === 'terminal' && (
          <div className={styles.terminalVazio}>
            <TerminalIcon size={22} />
            <p>
              O terminal interativo do container do projeto ainda não existe —
              é a FASE 25b, que ficou cortada e declarada (ADR 0065, RN-105/106).
              Hoje o container só decide QUAL imagem sobe; o ciclo de vida dele
              (provisionar, reciclar, o worktree do agente vivendo lá dentro)
              é a fase seguinte.
            </p>
          </div>
        )}
        {aba === 'diff' && <CodeDiffPanel projectId={projectId} />}
      </div>
    </div>
  );
}

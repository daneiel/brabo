import { useState } from 'react';
import { AlertIcon, OutputIcon, TerminalIcon } from '../../components/ui/icons';
import { CodeDiffPanel } from './CodeDiffPanel';
import styles from './CodeBottomPanel.module.css';

type PainelInferior = 'terminal' | 'problems' | 'diff' | 'output';

const ABAS: { chave: PainelInferior; rotulo: string }[] = [
  { chave: 'terminal', rotulo: 'Terminal' },
  { chave: 'problems', rotulo: 'Problemas' },
  { chave: 'diff', rotulo: 'Diff de PR' },
  { chave: 'output', rotulo: 'Saída' },
];

/**
 * Painel inferior, as quatro abas do handoff (item 279 do
 * `design_handoff_brabo/README.md`): Terminal, Problemas, Diff e Saída.
 *
 * Só Diff tem dado real por trás (lista navegável de PRs — RN-111 — que abre
 * o diff por id ao clicar; quem já sabe o id continua podendo colar direto).
 * As outras três nascem com estado vazio HONESTO, e cada uma explica por quê
 * — nenhuma decoração fingindo integração que não existe:
 *
 * - Terminal: interativo é FASE 25b, que ainda não subiu.
 * - Problemas: não há lint/diagnóstico algum rodando sobre o código do
 *   projeto gerido nesta aba — o badge "3" do handoff é mock. Inventar a
 *   contagem seria o mesmo erro que o ADR 0077 já recusou para nota de
 *   qualidade de modelo: número que não vem de medição real.
 * - Saída: não há stream de comando de build/deploy nesta aba — só o
 *   terminal interativo (FASE 25b) produziria esse stream, e ele também não
 *   existe ainda.
 */
export function CodeBottomPanel({ projectId }: { projectId: string }) {
  const [aba, setAba] = useState<PainelInferior>('terminal');

  return (
    <div className={styles.painel}>
      <div className={styles.abas} role="tablist" aria-label="Painel inferior">
        {ABAS.map((item) => (
          <button
            key={item.chave}
            type="button"
            role="tab"
            aria-selected={aba === item.chave}
            className={[styles.aba, aba === item.chave && styles.abaAtiva].filter(Boolean).join(' ')}
            onClick={() => setAba(item.chave)}
          >
            {item.rotulo}
          </button>
        ))}
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
        {aba === 'problems' && (
          <div className={styles.terminalVazio}>
            <AlertIcon size={22} />
            <p>
              Não há lint nem testes integrados rodando sobre o código deste
              projeto — nenhuma ferramenta de análise estática hoje escaneia o
              repositório gerido. Mostrar uma contagem de erros ou avisos aqui
              seria decoração, não estado: quando essa integração existir, esta
              aba passa a listar diagnósticos reais.
            </p>
          </div>
        )}
        {aba === 'diff' && <CodeDiffPanel projectId={projectId} />}
        {aba === 'output' && (
          <div className={styles.terminalVazio}>
            <OutputIcon size={22} />
            <p>
              Não há stream de comando de build ou deploy nesta aba — esse
              stream viria do terminal interativo (FASE 25b), que também ainda
              não existe. `git push`, PR e deploy não saem pelo terminal de
              qualquer forma (RN-106): quando houver execução de comando real
              dentro do container, a saída dela aparece aqui.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

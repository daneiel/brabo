import { useState } from 'react';
import { ProjectChatTab } from './ProjectSessionsTab';
import { ProjectRagTab } from './ProjectRagTab';
import styles from './ProjectChatShell.module.css';

type SegmentoDeChat = 'conversar' | 'buscar';

const SEGMENTOS: { chave: SegmentoDeChat; rotulo: string }[] = [
  { chave: 'conversar', rotulo: 'Conversar' },
  { chave: 'buscar', rotulo: 'Buscar' },
];

/**
 * O segmento inicial, lido da URL UMA vez, no mount — mesmo contrato de
 * `?tab=` no resto do produto ("só vale como deep-link INICIAL", ver
 * `project-tabs.ts`). Não usa o router: `ProjectChatShell` é escolhido
 * dinamicamente por `abaPorChave`/`PainelDaAba` em `ProjectPage.tsx`, que só
 * repassa `projectId` a QUALQUER painel (contrato genérico de
 * `AbaDoProjeto.component`) — amarrar este componente a um hook de rota
 * alargaria esse contrato só para esta aba.
 *
 * `?tab=rag` é o link antigo da aba que existia sozinha (Onda 5, frente G3)
 * antes desta fusão: abre aqui já em "Buscar". Qualquer outro valor
 * (inclusive `?tab=sessions`, o alias do Chat de antes, ou nenhum `tab`)
 * abre em "Conversar" — o caminho mais comum.
 */
function segmentoInicial(): SegmentoDeChat {
  if (typeof window === 'undefined') return 'conversar';
  const params = new URLSearchParams(window.location.search);
  return params.get('tab') === 'rag' ? 'buscar' : 'conversar';
}

/**
 * Chat + Chat RAG, fundidos num contêiner de UI só (PROGRAMA de abas
 * agrupadas — Onda 1).
 *
 * A fusão é SÓ de apresentação. `ProjectChatTab` (RN-058: ativa um agente
 * conversacional e gasta a chave do owner do workspace por turno) e
 * `ProjectRagTab` (RN-202/ADR 0082: busca híbrida read-only sobre o índice,
 * sem agente nenhum no meio) continuam os dois caminhos de dados de sempre —
 * nenhuma linha de lógica dos dois mudou, e os testes de cada um continuam
 * montando o componente sozinho, sem este shell no meio.
 *
 * O controle segmentado (RN-096/pattern dos pills de filtro já usado em
 * `ProjectSessionsTab.tsx`) é estado LOCAL — não sincroniza com a URL a cada
 * clique, mesma regra do resto da régua de abas.
 */
export function ProjectChatShell({ projectId }: { projectId: string }) {
  const [segmento, setSegmento] = useState<SegmentoDeChat>(segmentoInicial);

  return (
    <div className={styles.shell}>
      <div
        className={styles.segmentado}
        role="group"
        aria-label="Modo do Chat"
      >
        {SEGMENTOS.map((s) => (
          <button
            key={s.chave}
            type="button"
            className={
              segmento === s.chave
                ? `${styles.pill} ${styles.pillAtivo}`
                : styles.pill
            }
            aria-pressed={segmento === s.chave}
            onClick={() => setSegmento(s.chave)}
          >
            {s.rotulo}
          </button>
        ))}
      </div>

      <div className={styles.corpo}>
        {segmento === 'conversar' ? (
          <ProjectChatTab projectId={projectId} />
        ) : (
          <ProjectRagTab projectId={projectId} />
        )}
      </div>
    </div>
  );
}

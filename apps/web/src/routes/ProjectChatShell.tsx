import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectChatTab } from './ProjectSessionsTab';
import { ProjectRagTab } from './ProjectRagTab';
import styles from './ProjectChatShell.module.css';

type SegmentoDeChat = 'conversar' | 'buscar';

const CHAVE_DO_SEGMENTO: Record<SegmentoDeChat, string> = {
  conversar: 'chatShell.segments.chat',
  buscar: 'chatShell.segments.search',
};

const ORDEM_DOS_SEGMENTOS: SegmentoDeChat[] = ['conversar', 'buscar'];

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
  const { t } = useTranslation('sessions');
  const [segmento, setSegmento] = useState<SegmentoDeChat>(segmentoInicial);

  return (
    <div className={styles.shell}>
      <div
        className={styles.segmentado}
        role="group"
        aria-label={t('chatShell.ariaLabel')}
      >
        {ORDEM_DOS_SEGMENTOS.map((chave) => (
          <button
            key={chave}
            type="button"
            className={
              segmento === chave
                ? `${styles.pill} ${styles.pillAtivo}`
                : styles.pill
            }
            aria-pressed={segmento === chave}
            onClick={() => setSegmento(chave)}
          >
            {t(CHAVE_DO_SEGMENTO[chave])}
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

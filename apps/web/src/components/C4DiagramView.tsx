import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { C4Diagrama } from '../lib/api-types';
import { renderMermaid } from '../lib/mermaid-render';
import { Alert } from './ui/Alert';
import { ExpandIcon } from './ui/icons';
import { Modal } from './ui/Modal';
import { Skeleton } from './ui/Skeleton';
import styles from './C4DiagramView.module.css';

/**
 * Renderiza o diagrama C4 (Context + Container, modelo de Simon Brown) que o
 * Arquiteto gerou — sintaxe Mermaid vinda do artefato `artifact.c4_diagram`.
 * O motor (`mermaid`) mora atrás de `lib/mermaid-render.ts` — ver o
 * moduledoc de lá pro porquê do seam.
 *
 * Três estados por diagrama (RN-088 — nunca `if (!svg) return null`):
 * `rendering` (Skeleton), `erro` (sintaxe inválida ou falha do Mermaid — a
 * tela explica e mostra a sintaxe crua, nunca quebra) e `pronto` (o SVG,
 * com botão de ampliar — ONDA 3 do PROGRAMA de abas agrupadas: primeiro
 * lightbox do design system, construído sobre `ui/Modal.tsx`). O quarto
 * estado, "sem diagrama nenhum", é responsabilidade de quem chama este
 * componente — ver `ProjectArchitectureTab.tsx`.
 */

type EstadoDeRender =
  | { fase: 'rendering' }
  | { fase: 'pronto'; svg: string }
  | { fase: 'erro'; mensagem: string };

function useMermaidRender(sintaxe: string, idBase: string): EstadoDeRender {
  const { t } = useTranslation('overview');
  const [estado, setEstado] = useState<EstadoDeRender>({ fase: 'rendering' });

  useEffect(() => {
    let cancelado = false;
    setEstado({ fase: 'rendering' });

    if (!sintaxe.trim()) {
      setEstado({ fase: 'erro', mensagem: t('c4.emptyDiagram') });
      return;
    }

    renderMermaid(idBase, sintaxe)
      .then(({ svg }) => {
        if (!cancelado) setEstado({ fase: 'pronto', svg });
      })
      .catch((erro: unknown) => {
        if (!cancelado) {
          setEstado({
            fase: 'erro',
            mensagem: erro instanceof Error ? erro.message : t('c4.invalidSyntax'),
          });
        }
      });

    return () => {
      cancelado = true;
    };
  }, [sintaxe, idBase, t]);

  return estado;
}

function DiagramaMermaid({
  titulo,
  sintaxe,
  idBase,
}: {
  titulo: string;
  sintaxe: string;
  idBase: string;
}) {
  const { t } = useTranslation('overview');
  const estado = useMermaidRender(sintaxe, idBase);
  // Lightbox (ONDA 3 — aba Arquitetura): só existe pergunta "ampliar?" no
  // estado `pronto` — carregando não tem o que ampliar, erro não tem SVG
  // nenhum (a sintaxe crua já está acessível dentro do próprio Alert).
  const [ampliado, setAmpliado] = useState(false);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitulo}>{titulo}</div>
        {estado.fase === 'pronto' && (
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => setAmpliado(true)}
            aria-label={t('c4.expandLabel', { titulo })}
            title={t('c4.expandTitle')}
          >
            <ExpandIcon size={13} />
          </button>
        )}
      </div>
      {estado.fase === 'rendering' && <Skeleton height={220} />}
      {estado.fase === 'erro' && (
        <Alert tone="danger">
          <strong>{t('c4.renderErrorTitle')}</strong>
          <p>{estado.mensagem}</p>
          <details className={styles.sintaxeCrua}>
            <summary>{t('c4.viewRawSyntax')}</summary>
            <pre>{sintaxe}</pre>
          </details>
        </Alert>
      )}
      {estado.fase === 'pronto' && (
        <div
          className={styles.svgWrap}
          // O SVG vem do `renderMermaid` que ACABAMOS de chamar acima —
          // conteúdo gerado por nós a partir de sintaxe já validada, nunca
          // HTML de terceiro repassado direto. `securityLevel: 'strict'`
          // garante que o Mermaid não emite `<script>`/handlers inline.
          dangerouslySetInnerHTML={{ __html: estado.svg }}
        />
      )}
      {ampliado && estado.fase === 'pronto' && (
        <Modal
          title={titulo}
          icon={<ExpandIcon size={15} />}
          onClose={() => setAmpliado(false)}
          size="full"
        >
          <div
            className={styles.svgWrapAmpliado}
            // Mesmo SVG do card, mesma garantia de origem — ver comentário
            // acima. Vetor: ampliar não perde qualidade.
            dangerouslySetInnerHTML={{ __html: estado.svg }}
          />
        </Modal>
      )}
    </div>
  );
}

interface C4DiagramViewProps {
  diagrama: C4Diagrama;
}

export function C4DiagramView({ diagrama }: C4DiagramViewProps) {
  const { t } = useTranslation('overview');
  const idPrefixo = useId().replace(/[:]/g, '_');

  return (
    <div className={styles.grid}>
      <DiagramaMermaid
        titulo={t('c4.titleContext')}
        sintaxe={diagrama.contextDiagram}
        idBase={`c4-context${idPrefixo}`}
      />
      <DiagramaMermaid
        titulo={t('c4.titleContainer')}
        sintaxe={diagrama.containerDiagram}
        idBase={`c4-container${idPrefixo}`}
      />
    </div>
  );
}

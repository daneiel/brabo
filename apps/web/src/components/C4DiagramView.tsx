import { useEffect, useId, useState } from 'react';
import type { C4Diagrama } from '../lib/api-types';
import { renderMermaid } from '../lib/mermaid-render';
import { Alert } from './ui/Alert';
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
 * tela explica e mostra a sintaxe crua, nunca quebra) e `pronto` (o SVG). O
 * quarto estado, "sem diagrama nenhum", é responsabilidade de quem chama este
 * componente — ver `ArchitectureSection` em `ProjectOverviewTab.tsx`.
 */

type EstadoDeRender =
  | { fase: 'rendering' }
  | { fase: 'pronto'; svg: string }
  | { fase: 'erro'; mensagem: string };

function useMermaidRender(sintaxe: string, idBase: string): EstadoDeRender {
  const [estado, setEstado] = useState<EstadoDeRender>({ fase: 'rendering' });

  useEffect(() => {
    let cancelado = false;
    setEstado({ fase: 'rendering' });

    if (!sintaxe.trim()) {
      setEstado({ fase: 'erro', mensagem: 'Diagrama vazio.' });
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
            mensagem: erro instanceof Error ? erro.message : 'Sintaxe Mermaid inválida.',
          });
        }
      });

    return () => {
      cancelado = true;
    };
  }, [sintaxe, idBase]);

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
  const estado = useMermaidRender(sintaxe, idBase);

  return (
    <div className={styles.card}>
      <div className={styles.cardTitulo}>{titulo}</div>
      {estado.fase === 'rendering' && <Skeleton height={220} />}
      {estado.fase === 'erro' && (
        <Alert tone="danger">
          <strong>Não foi possível desenhar este diagrama.</strong>
          <p>{estado.mensagem}</p>
          <details className={styles.sintaxeCrua}>
            <summary>Ver sintaxe Mermaid</summary>
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
    </div>
  );
}

interface C4DiagramViewProps {
  diagrama: C4Diagrama;
}

export function C4DiagramView({ diagrama }: C4DiagramViewProps) {
  const idPrefixo = useId().replace(/[:]/g, '_');

  return (
    <div className={styles.grid}>
      <DiagramaMermaid
        titulo="Contexto"
        sintaxe={diagrama.contextDiagram}
        idBase={`c4-context${idPrefixo}`}
      />
      <DiagramaMermaid
        titulo="Container"
        sintaxe={diagrama.containerDiagram}
        idBase={`c4-container${idPrefixo}`}
      />
    </div>
  );
}

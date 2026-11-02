import '@xyflow/react/dist/style.css';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';

export interface ModuloDoGrafo {
  name: string;
  stack: string;
  dependsOn: string[];
}

/* Camada de cada módulo = 1 + a maior camada das dependências (o corte do ciclo evita laço infinito). */
function camadas(modulos: ModuloDoGrafo[]): Map<string, number> {
  const porNome = new Map(modulos.map((m) => [m.name, m]));
  const memo = new Map<string, number>();
  const visitar = (nome: string, pilha: Set<string>): number => {
    const feito = memo.get(nome);
    if (feito !== undefined) return feito;
    if (pilha.has(nome)) return 0;
    pilha.add(nome);
    const deps = (porNome.get(nome)?.dependsOn ?? []).filter((d) => porNome.has(d));
    const camada = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => visitar(d, pilha)));
    pilha.delete(nome);
    memo.set(nome, camada);
    return camada;
  };
  modulos.forEach((m) => visitar(m.name, new Set()));
  return memo;
}

/* Controles de zoom pelos tokens do tema (a lib traz branco fixo). */
export const CONTROLES = {
  '--xy-controls-button-background-color': 'var(--surface-2)',
  '--xy-controls-button-background-color-hover': 'var(--surface-2)',
  '--xy-controls-button-color': 'var(--text-primary)',
  '--xy-controls-button-border-color': 'var(--border-strong)',
} as CSSProperties;

/* Grafo de módulos (AT-684): nós = módulos, arestas = dependsOn, derivados do module_map vigente. */
export function grafoDe(modulos: ModuloDoGrafo[]): { nos: Node[]; arestas: Edge[] } {
  const camada = camadas(modulos);
  const contagem = new Map<number, number>();
  const nos: Node[] = modulos.map((m) => {
    const c = camada.get(m.name) ?? 0;
    const i = contagem.get(c) ?? 0;
    contagem.set(c, i + 1);
    return {
      id: m.name,
      position: { x: i * 240, y: c * 120 },
      data: {
        label: (
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 600 }}>{m.name}</div>
            <div title={m.stack} style={{ fontSize: 10, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.stack}
            </div>
          </div>
        ),
      },
      style: {
        background: 'var(--surface-2)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        fontSize: 12,
        width: 200,
      },
    };
  });
  const nomes = new Set(modulos.map((m) => m.name));
  const arestas: Edge[] = modulos.flatMap((m) =>
    m.dependsOn
      .filter((d) => nomes.has(d))
      .map((d) => ({
        id: `${m.name}->${d}`,
        source: m.name,
        target: d,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: 'var(--border-strong)' },
      })),
  );

  return { nos, arestas };
}

export function Canvas({ modulos }: { modulos: ModuloDoGrafo[] }) {
  const { t } = useTranslation('overview');
  if (modulos.length === 0) return <p data-slot="ai-canvas-vazio">{t('grafo.vazio')}</p>;
  const { nos, arestas } = grafoDe(modulos);
  return (
    <div data-slot="ai-canvas" className="h-96 w-full overflow-hidden rounded-lg border bg-card" style={CONTROLES}>
      <ReactFlow nodes={nos} edges={arestas} nodesConnectable={false} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

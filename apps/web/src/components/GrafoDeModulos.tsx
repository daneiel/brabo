import { lazy, Suspense } from 'react';
import type { ModuloDoGrafo } from './ai-elements/canvas';

/* import() dinâmico: o @xyflow/react só baixa quando a aba Arquitetura mostra o grafo (AT-300). */
const Canvas = lazy(() => import('./ai-elements/canvas').then((m) => ({ default: m.Canvas })));

export function GrafoDeModulos({ modulos }: { modulos: ModuloDoGrafo[] }) {
  return (
    <Suspense fallback={<p>Carregando o grafo…</p>}>
      <Canvas modulos={modulos} />
    </Suspense>
  );
}

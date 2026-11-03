import { lazy, Suspense } from 'react';
import type { SpendPorDia } from '../lib/spend';
import { BarrasPorDia } from './SpendCharts';
import { Card } from './shadcn/card';

// Carga sob demanda (RN-973): o recharts fica no chunk próprio; o SVG de hoje é o fallback.
const Grafico = lazy(() => import('./GraficoDeGastoPorDia'));

export function GastoPorDia(props: { serie: SpendPorDia[]; titulo: string }) {
  return (
    <Card className="p-4 [&_figure]:m-0">
      <Suspense fallback={<BarrasPorDia {...props} />}>
        <Grafico {...props} />
      </Suspense>
    </Card>
  );
}

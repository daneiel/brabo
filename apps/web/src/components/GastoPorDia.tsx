import { lazy, Suspense } from 'react';
import type { SpendPorDia } from '../lib/spend';
import { BarrasPorDia } from './SpendCharts';
import { Card } from './shadcn/card';

// Carga sob demanda (RN-973): os três gráficos moram no MESMO módulo, logo no mesmo chunk do recharts.
const Grafico = lazy(() => import('./GraficoDeGastoPorDia'));
const Chamadas = lazy(() =>
  import('./GraficoDeGastoPorDia').then((m) => ({ default: m.GraficoDeChamadasPorDia })),
);
const Tokens = lazy(() =>
  import('./GraficoDeGastoPorDia').then((m) => ({ default: m.GraficoDeTokens })),
);

/** Gasto por dia em 2/3; chamadas por dia e a rosca de tokens em 1/3 (AT-720). */
export function GastoPorDia(props: {
  serie: SpendPorDia[];
  titulo: string;
  tokens?: { entrada: number; saida: number };
}) {
  const { serie, titulo, tokens } = props;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-4 lg:col-span-2 [&_figure]:m-0">
        <Suspense fallback={<BarrasPorDia serie={serie} titulo={titulo} />}>
          <Grafico serie={serie} titulo={titulo} />
        </Suspense>
      </Card>
      <div className="grid content-start gap-4">
        <Card className="p-4 [&_figure]:m-0">
          <Suspense fallback={null}>
            <Chamadas serie={serie} />
          </Suspense>
        </Card>
        {tokens && (
          <Card className="p-4 [&_figure]:m-0">
            <Suspense fallback={null}>
              <Tokens entrada={tokens.entrada} saida={tokens.saida} />
            </Suspense>
          </Card>
        )}
      </div>
    </div>
  );
}

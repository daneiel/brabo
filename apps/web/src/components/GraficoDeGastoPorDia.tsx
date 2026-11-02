import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { diaCurto, type SpendPorDia } from '../lib/spend';
import { formatarUsd } from './CredentialSpendSection';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from './shadcn/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './shadcn/table';

/**
 * A série diária do gasto desenhada pelo Chart do shadcn (AT-658, RN-973).
 * Mora em arquivo PRÓPRIO e é carregada por `React.lazy`: o recharts não pode
 * entrar em `SpendCharts.tsx`, que a aba Sessões também importa.
 */
export default function GraficoDeGastoPorDia({
  serie,
  titulo,
}: {
  serie: SpendPorDia[];
  titulo: string;
}) {
  const { t } = useTranslation('spend');
  // RN-180: o título diz a janela; a série é densa, então dia sem gasto é zero visível.
  const completo = `${titulo} — ${t('charts.window', { count: serie.length })}`;
  const dados = serie.map((p) => ({ ...p, rotulo: diaCurto(p.dia) }));
  const config: ChartConfig = {
    costMicros: { label: t('charts.spend'), color: 'var(--accent)' },
  };

  return (
    <figure className="m-0 grid gap-2">
      <figcaption className="text-sm text-[var(--text-muted)]">{completo}</figcaption>
      <div role="img" aria-label={completo}>
        <ChartContainer config={config} className="aspect-auto h-40 w-full">
          <BarChart data={dados} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(v: number) => formatarUsd(v)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  valueFormatter={(v) => formatarUsd(Number(v))}
                  detailFormatter={(p) =>
                    t('charts.calls', { count: (p as SpendPorDia).chamadas })
                  }
                />
              }
            />
            <Bar dataKey="costMicros" fill="var(--color-costMicros)" />
          </BarChart>
        </ChartContainer>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-[var(--text-muted)]">
          {t('charts.viewAsTable')}
        </summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('charts.colDay')}</TableHead>
              <TableHead>{t('charts.colSpend')}</TableHead>
              <TableHead>{t('charts.colCalls')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {serie.map((p) => (
              <TableRow key={p.dia}>
                <TableCell>{diaCurto(p.dia)}</TableCell>
                <TableCell>{formatarUsd(p.costMicros)}</TableCell>
                <TableCell>{p.chamadas}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}

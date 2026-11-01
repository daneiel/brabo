import * as React from "react"
import * as RechartsPrimitive from "recharts"
import { cn } from "@/lib/utils"

// Chart do shadcn (base-nova), recorte usado pela página de Gastos (AT-658):
// ChartContainer (cor por ChartConfig -> --color-<chave>), ChartTooltip e
// ChartTooltipContent. Sem legenda nem tema por seletor: a cor é `var(--token)`.
export type ChartConfig = Record<
  string,
  { label?: React.ReactNode; color?: string }
>

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null)

function useChart() {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error("useChart deve estar dentro de <ChartContainer />")
  return ctx
}

function ChartContainer({
  className,
  children,
  config,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
}) {
  const cores = Object.fromEntries(
    Object.entries(config)
      .filter(([, c]) => c.color)
      .map(([k, c]) => [`--color-${k}`, c.color])
  ) as React.CSSProperties
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        style={{ ...cores, ...style }}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  labelFormatter,
  valueFormatter,
  detailFormatter,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown; payload?: unknown }>
  label?: React.ReactNode
  className?: string
  labelFormatter?: (label: React.ReactNode, payload: unknown) => React.ReactNode
  valueFormatter?: (value: unknown) => React.ReactNode
  detailFormatter?: (payload: unknown) => React.ReactNode
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null
  const item = payload[0]
  const nome = config[String(item.dataKey)]?.label
  return (
    <div
      className={cn(
        "grid min-w-32 gap-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-xl",
        className
      )}
    >
      <div className="font-medium">
        {labelFormatter ? labelFormatter(label, item.payload) : label}
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{nome}</span>
        <span className="font-mono font-medium tabular-nums">
          {valueFormatter ? valueFormatter(item.value) : String(item.value)}
        </span>
      </div>
      {detailFormatter && (
        <div className="text-muted-foreground">{detailFormatter(item.payload)}</div>
      )}
    </div>
  )
}

export { ChartContainer, ChartTooltip, ChartTooltipContent }

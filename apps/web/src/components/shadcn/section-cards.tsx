import * as React from "react"
import { cn } from "@/lib/utils"
import { Card } from "./card"

export type MetricaDoCard = {
  rotulo: string
  valor: React.ReactNode
  /** Linha de apoio já pronta; o componente não calcula tendência. */
  nota?: React.ReactNode
}

// Cards de métrica do dashboard-01, sem degradê de primary nem badge de tendência (AT-714).
// O fundo usa o realce de acento do Brabo (`--accent-soft`), um token.
function SectionCards({
  metricas,
  className,
  ...props
}: React.ComponentProps<"div"> & { metricas: MetricaDoCard[] }) {
  return (
    <div
      data-slot="section-cards"
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4",
        className
      )}
      {...props}
    >
      {metricas.map((m) => (
        <Card
          key={m.rotulo}
          data-slot="section-card"
          className="bg-gradient-to-t from-[var(--accent-soft)] to-card"
        >
          <p className="font-mono text-[10px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
            {m.rotulo}
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
            {m.valor}
          </p>
          {m.nota && (
            <p className="mt-1 text-sm text-muted-foreground">{m.nota}</p>
          )}
        </Card>
      ))}
    </div>
  )
}

export { SectionCards }

import * as React from "react"
import { cn } from "@/lib/utils"

// Cabeçalho de página linear (AT-714): título, descrição e ações à direita.
function CabecalhoDePagina({
  titulo,
  descricao,
  acoes,
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  titulo: React.ReactNode
  descricao?: React.ReactNode
  acoes?: React.ReactNode
}) {
  return (
    <header
      data-slot="cabecalho-de-pagina"
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border)] pb-4",
        className
      )}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">{titulo}</h1>
        {descricao && (
          <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
        )}
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
    </header>
  )
}

export { CabecalhoDePagina }

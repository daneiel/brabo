import * as React from "react"
import { cn } from "@/lib/utils"

// Cabeçalho de página linear (AT-714): título, descrição e ações à direita.
function CabecalhoDePagina({
  icone,
  titulo,
  descricao,
  acoes,
  nivel = "h1",
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  icone?: React.ReactNode
  titulo: React.ReactNode
  descricao?: React.ReactNode
  acoes?: React.ReactNode
  nivel?: "h1" | "h2"
}) {
  const Titulo = nivel
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
        <Titulo className="text-xl font-semibold text-foreground">
          {icone && <span aria-hidden="true" className="mr-2 inline-flex align-[-3px] text-muted-foreground">{icone}</span>}
          {titulo}
        </Titulo>
        {descricao && (
          <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
        )}
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
    </header>
  )
}

export { CabecalhoDePagina }

import * as React from "react"
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

// Grade de divs da casa (antigo Table.module.css, RN-651): colunas em fração não existem em <table>.
const BORDA = "border-[color:var(--border)]"
const CELULA_MONO =
  "font-mono text-[10px] font-semibold tracking-[0.05em] text-[color:var(--text-secondary)] uppercase"

function Grade({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="grade"
      className={cn(
        `w-full overflow-hidden rounded-[var(--radius-lg)] border ${BORDA}`,
        className
      )}
      {...props}
    />
  )
}

function GradeCabecalho({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="grade-cabecalho"
      className={cn("bg-[var(--surface-2)]", className)}
      {...props}
    />
  )
}

function GradeCorpo(props: React.ComponentProps<"div">) {
  return <div data-slot="grade-corpo" {...props} />
}

function GradeLinha({
  className,
  corpo,
  ...props
}: React.ComponentProps<"div"> & { corpo?: boolean }) {
  return (
    <div
      data-slot="grade-linha"
      className={cn(
        "grid items-center",
        corpo &&
          `border-t ${BORDA} transition-[background] duration-100 ease-[ease] hover:bg-[var(--surface-1)]`,
        className
      )}
      {...props}
    />
  )
}

function GradeCelula({
  className,
  cabecalho,
  ...props
}: React.ComponentProps<"div"> & { cabecalho?: boolean }) {
  return (
    <div
      data-slot="grade-celula"
      className={cn(
        `min-w-0 border-l px-3.5 py-[11px] font-sans text-[13px] text-[color:var(--text-primary)] first:border-l-0 ${BORDA}`,
        cabecalho && CELULA_MONO,
        className
      )}
      {...props}
    />
  )
}

function GradeVazia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="grade-vazia"
      className={cn(
        "px-3.5 py-8 text-center text-[13px] text-[color:var(--text-muted)]",
        className
      )}
      {...props}
    />
  )
}

// Layout móvel (AT-330, RN-643): a linha vira cartão empilhado.
function GradeCartao({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="grade-cartao"
      className={cn(
        `flex min-w-0 flex-col gap-2 px-3.5 py-3 not-first:border-t not-first:border-t-[color:var(--border)]`,
        className
      )}
      {...props}
    />
  )
}

function GradeCampo({
  className,
  largo,
  ...props
}: React.ComponentProps<"div"> & { largo?: boolean }) {
  return (
    <div
      data-slot="grade-campo"
      data-largo={largo ? "" : undefined}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(72px,32%)_minmax(0,1fr)] items-baseline gap-2.5 font-sans text-[13px] text-[color:var(--text-primary)] data-[largo]:grid-cols-[minmax(0,1fr)] data-[largo]:gap-1",
        className
      )}
      {...props}
    />
  )
}

function GradeRotulo({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="grade-rotulo"
      className={cn(CELULA_MONO, "[overflow-wrap:anywhere]", className)}
      {...props}
    />
  )
}

function GradeValor({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="grade-valor"
      className={cn("min-w-0 [overflow-wrap:anywhere]", className)}
      {...props}
    />
  )
}

export {
  Grade,
  GradeCabecalho,
  GradeCorpo,
  GradeLinha,
  GradeCelula,
  GradeVazia,
  GradeCartao,
  GradeCampo,
  GradeRotulo,
  GradeValor,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

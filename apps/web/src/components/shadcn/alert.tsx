import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Valores do antigo Alert.module.css (ADR 0036), via tokens da casa.
const alertVariants = cva(
  "group/alert flex w-full items-start gap-2.5 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2.5",
  {
    variants: {
      variant: {
        // Erro de formulário: tingido, sem barra lateral.
        danger:
          "border-[color:var(--danger-line)] bg-[var(--danger-soft)] text-[color:var(--text-primary)]",
        // Aviso: superfície com acento de 2px na borda esquerda.
        warning: "border-l-2 border-l-[color:var(--warning)]",
        success: "border-l-2 border-l-[color:var(--success)]",
        accent: "border-l-2 border-l-[color:var(--accent)]",
      },
    },
    defaultVariants: {
      variant: "warning",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-tone={variant ?? "warning"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertIcone({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="alert-icon"
      aria-hidden="true"
      className={cn(
        "mt-0.5 grid shrink-0 place-items-center group-data-[tone=danger]/alert:text-[color:var(--danger)] group-data-[tone=warning]/alert:text-[color:var(--warning)] group-data-[tone=success]/alert:text-[color:var(--success)] group-data-[tone=accent]/alert:text-[color:var(--accent)]",
        className
      )}
      {...props}
    />
  )
}

function AlertTexto({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-text"
      className={cn(
        "font-sans text-[length:var(--fs-body)] leading-normal text-pretty text-[color:var(--text-secondary)] group-data-[tone=danger]/alert:text-[color:var(--text-primary)] [&_p]:m-0 [&_strong]:font-semibold [&_strong]:text-[color:var(--text-primary)]",
        className
      )}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertIcone, AlertTexto, AlertTitle, AlertDescription, AlertAction }

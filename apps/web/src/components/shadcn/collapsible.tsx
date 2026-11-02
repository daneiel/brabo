import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { cn } from "@/lib/utils"

function Collapsible({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

/** Cabeçalho da casa: alvo de 24px (WCAG 2.5.8), a linha inteira alterna. */
function CollapsibleTrigger({
  className,
  ...props
}: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "flex min-h-6 w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-2 text-left font-[family-name:var(--font-body)] text-[13px] font-semibold text-[var(--text-secondary)] transition-colors duration-100 hover:text-foreground focus-visible:rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        className
      )}
      {...props}
    />
  )
}

function CollapsibleContent({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn("flex flex-col [&[hidden]]:hidden", className)}
      {...props}
    />
  )
}

/** Chevron decorativo: o estado já é anunciado pelo `aria-expanded`. */
function CollapsibleIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="collapsible-icon"
      aria-hidden="true"
      className={cn("flex shrink-0 text-[var(--text-muted)]", className)}
      {...props}
    />
  )
}

function CollapsibleTitle({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="collapsible-title" className={cn("min-w-0 flex-1", className)} {...props} />
}

function CollapsibleTrailing({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="collapsible-trailing"
      className={cn("shrink-0 font-[family-name:var(--font-mono)] text-[10px] font-normal text-[var(--text-muted)]", className)}
      {...props}
    />
  )
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleIcon,
  CollapsibleTitle,
  CollapsibleTrailing,
}

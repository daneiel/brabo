import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Retematizado com o Badge da casa (AT-646): mono, pílula, tons pelos tokens.
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center gap-1.5 rounded-[var(--radius-full)] border border-transparent px-2 py-[3px] font-[family-name:var(--font-mono)] text-[length:var(--fs-label)] font-medium whitespace-nowrap focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        success:
          "border-[color:var(--success-line)] bg-[var(--success-soft)] text-[color:var(--success)]",
        warning:
          "border-[color:var(--warning-line)] bg-[var(--warning-soft)] text-[color:var(--warning)]",
        danger:
          "border-[color:var(--danger-line)] bg-[var(--danger-soft)] text-[color:var(--danger)]",
        accent:
          "border-[color:var(--accent-line)] bg-[var(--accent-soft)] text-[color:var(--accent)]",
        muted:
          "border-[color:var(--border)] bg-[var(--surface-2)] text-[color:var(--text-muted)]",
        neutral:
          "border-[color:var(--border)] bg-[var(--surface-2)] text-[color:var(--text-secondary)]",
        agent:
          "border-[color:color-mix(in_srgb,var(--agent-color)_var(--tint-line),transparent)] bg-[color-mix(in_srgb,var(--agent-color)_var(--tint-soft),transparent)] text-[color:var(--agent-color)]",
      },
      size: {
        sm: "",
        md: "text-[length:var(--fs-meta)]",
      },
      square: {
        true: "rounded-[var(--radius-md)] py-0.5",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
      square: false,
    },
  }
)

function Badge({
  className,
  variant = "default",
  size = "sm",
  square = false,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size, square }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

/** A bolinha de estado do Badge; `pulse` anima (e para com `prefers-reduced-motion`). */
function BadgeDot({ pulse, className }: { pulse?: boolean; className?: string }) {
  return (
    <span
      data-slot="badge-dot"
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-current",
        pulse && "animate-[bpulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
        className
      )}
    />
  )
}

export { Badge, BadgeDot }

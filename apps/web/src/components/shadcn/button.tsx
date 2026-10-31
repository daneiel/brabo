import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Valores do antigo `ui/Button.module.css`, via tokens da casa (AT-646).
const semFundoOff =
  "disabled:border-[var(--border-strong)] disabled:text-[var(--text-muted)]"
const cheioOff = `disabled:bg-[var(--surface-2)] ${semFundoOff}`

const buttonVariants = cva(
  "group/button inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-md)] border border-transparent px-3 py-[9px] font-[family-name:var(--font-body)] text-[length:var(--fs-body)] font-semibold transition-[background,border-color,color] duration-[0.12s] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default: `border-primary bg-primary text-primary-foreground enabled:hover:border-[var(--accent-hover)] enabled:hover:bg-[var(--accent-hover)] ${cheioOff}`,
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: `border-[var(--border-strong)] bg-secondary text-secondary-foreground enabled:hover:border-[var(--text-muted)] ${cheioOff}`,
        ghost:
          "bg-transparent text-[var(--text-secondary)] enabled:hover:bg-[var(--surface-2)] enabled:hover:text-[var(--text-primary)] disabled:text-[var(--text-muted)]",
        destructive: `border-[var(--danger-line)] bg-transparent text-destructive enabled:hover:bg-[var(--danger-soft)] ${semFundoOff}`,
        success: `border-[var(--success)] bg-[var(--success)] text-[var(--on-accent)] enabled:hover:brightness-[1.08] disabled:brightness-100 ${cheioOff}`,
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "",
        xs: "h-6 px-2 text-xs",
        sm: "h-7 gap-1 px-[calc(var(--space-2)+2px)] py-0 text-[length:var(--fs-sm)]",
        lg: "h-11 px-4 py-0 text-[14px] tracking-[0.01em]",
        icon: "size-9 rounded-[var(--r-sm)] p-0",
        "icon-xs": "size-6 rounded-[var(--r-sm)] p-0",
        "icon-sm": "size-7 rounded-[var(--r-sm)] p-0",
        "icon-lg": "size-9 rounded-[var(--r-sm)] p-0",
      },
      fullWidth: { true: "w-full", false: "" },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      fullWidth: false,
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  fullWidth,
  loading,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      aria-busy={loading ? true : undefined}
      className={cn(buttonVariants({ variant, size, fullWidth, className }))}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-[15px] shrink-0 animate-[bspin_0.7s_linear_infinite] rounded-full border-2 border-[color-mix(in_srgb,currentColor_35%,transparent)] border-t-current motion-reduce:animate-none"
        />
      )}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }

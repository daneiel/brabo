/* oxlint-disable react/only-export-components -- exporta o cva (registry shadcn) */
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        // O chip de filtro da casa (AT-287): pílula mono; ligado = borda de acento.
        chip: "rounded-[var(--r-pill)] border border-[var(--border)] bg-card font-[family-name:var(--font-mono)] text-[length:var(--fs-sm)] font-normal text-muted-foreground hover:bg-card hover:text-muted-foreground enabled:hover:border-[var(--border-strong)] focus-visible:border-[var(--border)] focus-visible:ring-[var(--focus-ring)] aria-pressed:border-[var(--accent)] aria-pressed:bg-muted aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:hover:bg-muted aria-pressed:hover:text-foreground data-[tone=violet]:aria-pressed:border-[var(--violet)] disabled:pointer-events-auto disabled:cursor-not-allowed",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        chip: "h-auto min-h-6 min-w-0 px-3 py-1",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }

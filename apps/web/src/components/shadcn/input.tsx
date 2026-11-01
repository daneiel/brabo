import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-[9px] font-[family-name:var(--font-body)] text-[length:13px] text-[color:var(--text-primary)] transition-[border-color,box-shadow] duration-[120ms] outline-none placeholder:text-[color:var(--text-muted)] focus-visible:border-[color:var(--accent)] focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-[0_0_0_3px_var(--focus-ring)] forced-colors:focus-visible:outline-[Highlight] aria-invalid:border-[color:var(--danger)] aria-invalid:focus:border-[color:var(--danger)] aria-invalid:focus:shadow-[0_0_0_3px_var(--danger-ring)] data-[mono]:font-[family-name:var(--font-mono)] data-[mono]:text-[length:12px] data-[preenchido]:h-[42px] data-[preenchido]:bg-[var(--code-bg)] data-[preenchido]:px-[13px] data-[preenchido]:py-0 data-[preenchido]:text-[length:14px] data-[preenchido]:placeholder:text-[color:var(--text-secondary)] data-[preenchido]:data-[mono]:text-[length:13.5px] data-[preenchido]:data-[mono]:tracking-[0.02em] data-[icone]:pl-[34px] data-[revelavel]:pr-[44px]",
        className
      )}
      {...props}
    />
  )
}

export { Input }

import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-[88px] w-full resize-y rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-[9px] font-[family-name:var(--font-body)] text-[length:13px] leading-normal text-[color:var(--text-primary)] transition-[border-color,box-shadow] duration-[120ms] outline-none placeholder:text-[color:var(--text-muted)] focus-visible:border-[color:var(--accent)] focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-[0_0_0_3px_var(--focus-ring)] forced-colors:focus-visible:outline-[Highlight] aria-invalid:border-[color:var(--danger)] aria-invalid:focus:border-[color:var(--danger)] aria-invalid:focus:shadow-[0_0_0_3px_var(--danger-ring)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

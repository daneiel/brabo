import * as React from "react"
import { cn } from "@/lib/utils"

import { ChevronDownIcon } from "lucide-react"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
  /** `className` vai no `<select>` (como no Select da casa); o invólucro tem o seu. */
  wrapperClassName?: string
}

function NativeSelect({
  className,
  wrapperClassName,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative inline-block w-full has-[select:disabled]:opacity-50",
        wrapperClassName
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "w-full min-w-0 cursor-pointer appearance-none rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--surface-1)] py-[9px] pr-8 pl-3 font-[family-name:var(--font-body)] text-[length:13px] text-[color:var(--text-primary)] transition-[border-color,box-shadow] duration-[120ms] outline-none focus-visible:border-[color:var(--accent)] focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-[0_0_0_3px_var(--focus-ring)] forced-colors:focus-visible:outline-[Highlight] disabled:cursor-not-allowed aria-invalid:border-[color:var(--danger)]",
          className
        )}
        {...props}
      />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-[color:var(--text-muted)] select-none" strokeWidth={1.6} aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }

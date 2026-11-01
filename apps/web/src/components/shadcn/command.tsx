import * as React from "react"
import { Autocomplete as AC } from "@base-ui/react/autocomplete"
import { cn } from "@/lib/utils"

// Visual do `command` do shadcn sobre o Autocomplete do Base UI (sem cmdk/Radix).
function Command({ ...props }: React.ComponentProps<typeof AC.Root>) {
  return <AC.Root data-slot="command" open inline {...props} />
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof AC.Input>) {
  return (
    <AC.Input
      data-slot="command-input"
      className={cn(
        "h-11 w-full border-b border-[var(--border-strong)] bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof AC.List>) {
  return (
    <AC.List
      data-slot="command-list"
      className={cn("max-h-[320px] overflow-y-auto p-1", className)}
      {...props}
    />
  )
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof AC.Empty>) {
  return (
    <AC.Empty
      data-slot="command-empty"
      className={cn("p-4 text-center text-sm text-muted-foreground empty:hidden", className)}
      {...props}
    />
  )
}

function CommandGroup({ ...props }: React.ComponentProps<typeof AC.Group>) {
  return <AC.Group data-slot="command-group" {...props} />
}

function CommandGroupLabel({ className, ...props }: React.ComponentProps<typeof AC.GroupLabel>) {
  return (
    <AC.GroupLabel
      data-slot="command-group-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof AC.Item>) {
  return (
    <AC.Item
      data-slot="command-item"
      className={cn(
        "flex cursor-default items-center rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandGroupLabel, CommandItem }

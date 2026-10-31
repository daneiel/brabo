import * as React from "react"
import { cn } from "@/lib/utils"

// Retematizado com o Card da casa (AT-646): superfície, borda e raio pelos tokens.
const PADDING = {
  none: "p-0 [--card-spacing:0px]",
  sm: "p-[calc(var(--space-2)+var(--space-1))] [--card-spacing:calc(var(--space-2)+var(--space-1))]",
  md: "p-[var(--space-3)] [--card-spacing:var(--space-3)]",
  lg: "p-[var(--space-4)] [--card-spacing:var(--space-4)]",
} as const

function Card({
  className,
  padding = "md",
  radius = "lg",
  recorta = false,
  ...props
}: React.ComponentProps<"div"> & {
  padding?: keyof typeof PADDING
  radius?: "md" | "lg"
  recorta?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-padding={padding}
      data-radius={radius}
      data-recorta={recorta ? "true" : undefined}
      className={cn(
        "group/card border border-[color:var(--border)] bg-card text-card-foreground",
        radius === "md" ? "rounded-[var(--r-md)]" : "rounded-[var(--r-lg)]",
        PADDING[padding],
        recorta && "overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        " text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}

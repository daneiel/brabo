import { cn } from "@/lib/utils"

// Retematizado com o Skeleton da casa (AT-646): gradiente de superfícies; o raio vem de quem chama.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-[bshimmer_1.4s_ease-in-out_infinite] bg-[linear-gradient(90deg,var(--surface-1)_25%,var(--surface-2)_50%,var(--surface-1)_75%)] bg-[length:200%_100%] motion-reduce:animate-none motion-reduce:[background:var(--surface-2)]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }

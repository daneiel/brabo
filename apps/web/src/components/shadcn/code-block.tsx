import { useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Button } from "./button"

// Code Block do `base-nova` (AT-657, RN-972): casca + cabeçalho + ações. O
// realce vem de `lib/realce-shiki.ts`; aqui só moldura e o botão Copiar.
function CodeBlock({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block"
      className={cn(
        "my-1 mb-3 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--code-bg)]",
        className
      )}
      {...props}
    />
  )
}

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]",
        className
      )}
      {...props}
    />
  )
}

function CodeBlockActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="code-block-actions" className={cn("flex items-center gap-1", className)} {...props} />
}

/** Copia `code`; "Copiado" por 2 s, e a falha da área de transferência vira texto. */
function CodeBlockCopyButton({ code }: { code: string }) {
  const { t } = useTranslation("ui")
  const [estado, setEstado] = useState<"idle" | "ok" | "erro">("idle")
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setEstado("ok")
      setTimeout(() => setEstado("idle"), 2000)
    } catch {
      setEstado("erro")
    }
  }
  return (
    <Button type="button" variant="ghost" className="px-1.5 py-0 text-[10px] normal-case tracking-normal" onClick={copiar}>
      {estado === "ok" ? t("codeBlock.copiado") : estado === "erro" ? t("codeBlock.falhaAoCopiar") : t("codeBlock.copiar")}
    </Button>
  )
}

export { CodeBlock, CodeBlockHeader, CodeBlockActions, CodeBlockCopyButton }

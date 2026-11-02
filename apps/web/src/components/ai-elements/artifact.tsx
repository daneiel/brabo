import type { ReactNode } from 'react';
import { FileTextIcon } from 'lucide-react';

/* Cartão de artefato criado no turno (prévia AT-674): tipo, título e um trecho. */
export function ArtifactCard({ tipo, titulo, descricao }: { tipo: string; titulo: string; descricao?: ReactNode }) {
  return (
    <div data-slot="ai-artifact" className="flex w-full max-w-md flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileTextIcon className="size-3.5" aria-hidden="true" />
        <span data-slot="ai-artifact-tipo">{tipo}</span>
      </div>
      <div data-slot="ai-artifact-titulo" className="text-sm font-medium">{titulo}</div>
      {descricao && <div data-slot="ai-artifact-descricao" className="line-clamp-3 text-xs text-muted-foreground">{descricao}</div>}
    </div>
  );
}

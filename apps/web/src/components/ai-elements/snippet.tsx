import { AcaoCopiar } from './copiar';

/* Snippet do AI Elements: comando em bloco mono com botão de copiar (AT-683). */
export function Snippet({
  texto,
  rotulo,
  rotuloCopiado,
  aoFalhar,
}: {
  texto: string;
  rotulo: string;
  rotuloCopiado: string;
  aoFalhar?: () => void;
}) {
  return (
    <div
      data-slot="ai-snippet"
      className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--code-bg)] py-1 pl-3 pr-1"
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[var(--text)]">{texto}</code>
      <AcaoCopiar texto={texto} rotulo={rotulo} rotuloCopiado={rotuloCopiado} aoFalhar={aoFalhar} />
    </div>
  );
}

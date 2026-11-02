import { useState } from 'react';
import { ExternalLinkIcon, RotateCwIcon } from 'lucide-react';

/* Web preview (AT-685): barra de URL, recarregar, abrir em nova aba e iframe com sandbox mínimo. */
export function WebPreview({ url }: { url: string }) {
  const [versao, setVersao] = useState(0);
  const botao = 'inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted';
  return (
    <div data-slot="ai-web-preview" className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b p-2">
        <button type="button" className={botao} aria-label="Recarregar" onClick={() => setVersao((v) => v + 1)}>
          <RotateCwIcon className="size-3.5" aria-hidden="true" />
        </button>
        <input readOnly value={url} aria-label="Endereço" className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs" />
        <a className={botao} href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir em nova aba">
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        </a>
      </div>
      <iframe
        key={versao}
        src={url}
        title="Entregável"
        sandbox="allow-scripts allow-forms allow-same-origin"
        referrerPolicy="no-referrer"
        className="h-96 w-full bg-white"
      />
    </div>
  );
}

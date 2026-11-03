import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLinkIcon, RotateCwIcon } from 'lucide-react';

/* Web preview (AT-685): barra de URL, recarregar, abrir em nova aba e iframe com sandbox mínimo.
 * allow-same-origin + allow-scripts é seguro AQUI porque a URL é local (urlLocalSegura) e a origem
 * (localhost:<porta>) difere da do Brabo: o quadro nunca alcança o DOM, o cookie nem o storage do Brabo.
 * O CSP `frame-src` do nginx limita o alvo a localhost/127.0.0.1 (ADR 0239). */
export function WebPreview({ url }: { url: string }) {
  const { t } = useTranslation('overview');
  const [versao, setVersao] = useState(0);
  const botao = 'inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted';
  return (
    <div data-slot="ai-web-preview" className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b p-2">
        <button type="button" className={botao} aria-label={t('entregavel.recarregar')} onClick={() => setVersao((v) => v + 1)}>
          <RotateCwIcon className="size-3.5" aria-hidden="true" />
        </button>
        <input readOnly value={url} aria-label={t('entregavel.endereco')} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs" />
        <a className={botao} href={url} target="_blank" rel="noopener noreferrer" aria-label={t('entregavel.abrir')}>
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        </a>
      </div>
      <iframe
        key={versao}
        src={url}
        title={t('entregavel.titulo')}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className="h-96 w-full bg-white"
      />
    </div>
  );
}

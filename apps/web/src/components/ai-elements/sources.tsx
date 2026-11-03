import { useTranslation } from 'react-i18next';
import { LibraryIcon } from 'lucide-react';
import type { FonteDoTurno } from '../../lib/fontes-do-turno';
import { ChainOfThought } from './chain-of-thought';
import { sendSourceClick } from '../../lib/api-client';

/* AT-716: rodapé "Consultado neste turno" (RN-180/468: nunca "Fontes"). Sem args (RN-096). */
export function hrefDaFonte(f: FonteDoTurno, projectId: string): string | undefined {
  if (!f.ref) return undefined;
  if (f.tipo === 'historia')
    return `/projects/${projectId}?tab=backlog&historia=${encodeURIComponent(f.ref)}`;
  return /^https:\/\/\S+\/pull\/\d+/.test(f.ref) ? f.ref : undefined;
}

export function ConsultadoNesteTurno({
  fontes,
  total,
  projectId,
  sessionId,
  eventId,
}: {
  fontes: FonteDoTurno[];
  total: number;
  projectId: string;
  sessionId?: string;
  eventId?: string;
}) {
  const { t } = useTranslation('sessionPage');
  if (fontes.length === 0) return null;
  return (
    <div data-testid="consultado-neste-turno">
      <ChainOfThought
        titulo={t('turno.consultado')}
        contagem={
          total > fontes.length
            ? t('turno.consultadoCorte', { shown: fontes.length, total })
            : String(fontes.length)
        }
      >
        <ul className="flex flex-col gap-1 text-sm">
          {fontes.map((f, i) => {
            const href = hrefDaFonte(f, projectId);
            return (
              <li key={`${f.tipo}-${f.ref ?? f.rotulo}-${i}`} data-tipo={f.tipo} className="flex items-center gap-2">
                <LibraryIcon aria-hidden className="size-3.5 shrink-0" />
                {href ? (
                  <a
                    href={href}
                    onClick={() => {
                      // RN-983: dispara sem esperar; falha nunca bloqueia a navegação.
                      if (eventId) void sendSourceClick(projectId, { sessionId, eventId, tipo: f.tipo, ref: f.ref, searchId: f.searchId, chunkId: f.chunkId }).catch(() => undefined);
                    }}
                  >
                    {f.rotulo}
                  </a>
                ) : <span>{f.rotulo}</span>}
              </li>
            );
          })}
        </ul>
      </ChainOfThought>
    </div>
  );
}

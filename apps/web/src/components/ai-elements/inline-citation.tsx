import { useTranslation } from 'react-i18next';
import type { FonteDoTurno } from '../../lib/fontes-do-turno';
import { sendSourceClick } from '../../lib/api-client';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../shadcn/hover-card';
import { hrefDaFonte } from './sources';

/* AT-716: selo [n] inline. Lista simples, sem carrossel (decisão do dono). */
export function SeloDeCitacao({
  n,
  fonte,
  projectId,
  sessionId,
  eventId,
}: {
  n: number;
  fonte: FonteDoTurno;
  projectId: string;
  sessionId?: string;
  eventId?: string;
}) {
  const { t } = useTranslation('sessionPage');
  const href = hrefDaFonte(fonte, projectId);
  return (
    <HoverCard>
      <HoverCardTrigger
        render={<button type="button" />}
        aria-label={t('turno.fonteN', { n, rotulo: fonte.rotulo })}
        data-testid="selo-de-citacao"
        className="mx-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 align-super text-[10px] leading-4 text-muted-foreground"
      >
        {n}
      </HoverCardTrigger>
      <HoverCardContent>
        <span data-tipo={fonte.tipo}>
          {href ? (
            <a
              href={href}
              onClick={() => {
                // RN-983: dispara sem esperar; falha nunca bloqueia a navegação.
                if (eventId) void sendSourceClick(projectId, { sessionId, eventId, tipo: fonte.tipo, ref: fonte.ref, searchId: fonte.searchId, chunkId: fonte.chunkId }).catch(() => undefined);
              }}
            >
              {fonte.rotulo}
            </a>
          ) : (
            fonte.rotulo
          )}
        </span>
      </HoverCardContent>
    </HoverCard>
  );
}

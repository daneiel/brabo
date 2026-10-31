import type { ReactNode } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/shadcn/hover-card';
import { Progress, ProgressLabel, ProgressValue } from '@/components/shadcn/progress';

/*
 * Uso da janela de contexto (AT-647). `janela` nulo/0 = não sei: o corpo diz
 * `textoSemJanela` e NUNCA mostra 0%.
 */
type Props = {
  usados: number;
  janela: number | null | undefined;
  rotulo: string;
  textoSemJanela: string;
  children: ReactNode;
};

export function Context({ usados, janela, rotulo, textoSemJanela, children }: Props) {
  const conhecida = typeof janela === 'number' && janela > 0;
  const pct = conhecida ? Math.min(100, Math.round((usados / janela) * 100)) : null;
  return (
    <HoverCard>
      <HoverCardTrigger render={<button type="button" data-slot="ai-context-trigger" />}>{children}</HoverCardTrigger>
      <HoverCardContent data-slot="ai-context">
        {pct === null ? (
          <p data-slot="ai-context-desconhecido" className="text-sm">{textoSemJanela}</p>
        ) : (
          <Progress value={pct}>
            <ProgressLabel>{rotulo}</ProgressLabel>
            <ProgressValue />
          </Progress>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

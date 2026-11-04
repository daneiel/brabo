import type { ReactNode } from 'react';
import { BrainIcon } from 'lucide-react';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/shadcn/trace';

/*
 * Raciocínio do agente (AT-676): recolhido, texto inteiro em fonte de corpo,
 * rolável. Só apresentação; quem decide se há texto (e papel) é a api.
 */
export function Reasoning({
  titulo,
  contagem,
  texto,
  emCurso,
}: {
  titulo: ReactNode;
  contagem?: string;
  texto: string;
  emCurso?: boolean;
}) {
  return (
    <TraceCollapsible data-slot="ai-reasoning" data-testid="raciocinio-do-turno">
      <TraceCollapsibleTrigger>
        <TraceLine status={emCurso ? 'running' : undefined}>
          <TraceIcon><BrainIcon /></TraceIcon>
          <TraceTitle running={emCurso && typeof titulo === 'string'}>{titulo}</TraceTitle>
          {contagem && <TraceDescription>{contagem}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap pt-2 text-sm">{texto}</div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

import type { ReactNode } from 'react';
import { BrainIcon } from 'lucide-react';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/shadcn/trace';

/*
 * Cadeia de raciocínio (prévia AT-674). Só apresentação: cabeçalho recolhível
 * (título e contagem) com os passos dentro. Sem `aberto` nasce recolhido.
 */
type Props = {
  titulo: ReactNode;
  contagem?: string;
  emCurso?: boolean;
  children: ReactNode;
};

export function ChainOfThought({ titulo, contagem, emCurso, children }: Props) {
  return (
    <TraceCollapsible data-slot="ai-chain-of-thought">
      <TraceCollapsibleTrigger>
        <TraceLine status={emCurso ? 'running' : undefined}>
          <TraceIcon><BrainIcon /></TraceIcon>
          <TraceTitle running={emCurso && typeof titulo === 'string'}>{titulo}</TraceTitle>
          {contagem && <TraceDescription>{contagem}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace className="pt-2">{children}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

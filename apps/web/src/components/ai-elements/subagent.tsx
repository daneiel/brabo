import type { ReactNode } from 'react';
import { BotIcon } from 'lucide-react';
import { Badge } from '@/components/shadcn/badge';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/shadcn/trace';

/* Delegação a um subagente (Dev Lead → dev-<modulo>, AT-647). Corpo vem do chamador. */
type Props = {
  nome: string;
  etiqueta?: string;
  executando?: boolean;
  children?: ReactNode;
};

export function Subagent({ nome, etiqueta, executando, children }: Props) {
  return (
    <TraceCollapsible data-slot="ai-subagent">
      <TraceCollapsibleTrigger>
        <TraceLine status={executando ? 'running' : undefined}>
          <TraceIcon><BotIcon /></TraceIcon>
          <TraceTitle running={executando}>{nome}</TraceTitle>
          {etiqueta && <Badge variant="secondary">{etiqueta}</Badge>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

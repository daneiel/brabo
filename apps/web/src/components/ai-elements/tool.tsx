import type { ReactNode } from 'react';
import { WrenchIcon } from 'lucide-react';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/shadcn/trace';

/*
 * Chamada de ferramenta (AT-647). Só apresentação: o chamador deriva o estado
 * do par tool.call/tool.result (lib/timeline-tree.ts) e passa o texto pronto.
 * Entrada e saída em <pre>; falha aparece, nunca é escondida (RN-163).
 */
export type EstadoDaFerramenta = 'running' | 'error' | undefined;

type ToolProps = {
  titulo: string;
  estado?: EstadoDaFerramenta;
  entrada?: string;
  saida?: string;
  erro?: string;
  /** Texto já traduzido que declara o corte da saída (RN-589/RN-180). */
  avisoDeTruncada?: string;
  icone?: ReactNode;
};

const pre = 'overflow-x-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap';

export function Tool({ titulo, estado, entrada, saida, erro, avisoDeTruncada, icone }: ToolProps) {
  // Sem conteúdo (a faixa do turno, RN-460, nunca leva args) não há o que abrir.
  if (entrada === undefined && saida === undefined && erro === undefined && !avisoDeTruncada) {
    return (
      <TraceLine data-slot="ai-tool" status={estado}>
        <TraceIcon>{icone ?? <WrenchIcon />}</TraceIcon>
        <TraceTitle running={estado === 'running'}>{titulo}</TraceTitle>
      </TraceLine>
    );
  }
  return (
    <TraceCollapsible data-slot="ai-tool">
      <TraceCollapsibleTrigger>
        <TraceLine status={estado}>
          <TraceIcon>{icone ?? <WrenchIcon />}</TraceIcon>
          <TraceTitle running={estado === 'running'}>{titulo}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        {entrada !== undefined && <pre data-slot="ai-tool-input" className={pre}>{entrada}</pre>}
        {saida !== undefined && <pre data-slot="ai-tool-output" className={pre}>{saida}</pre>}
        {avisoDeTruncada && <p data-slot="ai-tool-truncated" className="text-xs">{avisoDeTruncada}</p>}
        {erro !== undefined && (
          <pre data-slot="ai-tool-error" role="alert" className={`${pre} text-destructive`}>{erro}</pre>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

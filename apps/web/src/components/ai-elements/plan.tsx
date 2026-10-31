import { CheckIcon, CircleDashedIcon, CircleDotIcon, MinusIcon } from 'lucide-react';
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/components/shadcn/trace';

/* Plano do agente (AT-647): pendente/em_curso/feito/descartado de agent.plan. */
export type EstadoDoPasso = 'pendente' | 'em_curso' | 'feito' | 'descartado';
export type PassoDoPlano = { texto: string; estado: EstadoDoPasso };

const icone = {
  pendente: <CircleDashedIcon />,
  em_curso: <CircleDotIcon />,
  feito: <CheckIcon />,
  descartado: <MinusIcon />,
} as const;

export function Plan({ objetivo, passos }: { objetivo: string; passos: PassoDoPlano[] }) {
  return (
    <Trace data-slot="ai-plan">
      <div data-slot="ai-plan-objetivo" className="text-sm font-medium">{objetivo}</div>
      {passos.map((p, i) => (
        <TraceLine
          key={i}
          data-estado={p.estado}
          status={p.estado === 'pendente' ? 'pending' : p.estado === 'em_curso' ? 'running' : undefined}
        >
          <TraceIcon>{icone[p.estado]}</TraceIcon>
          <TraceTitle running={p.estado === 'em_curso'} className={p.estado === 'descartado' ? 'line-through' : undefined}>
            {p.texto}
          </TraceTitle>
        </TraceLine>
      ))}
    </Trace>
  );
}

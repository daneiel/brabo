import { ClockIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/shadcn/button';
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/components/shadcn/trace';

/* Fila de mensagens (AT-647, RN-673): só quem enviou cancela (`podeCancelar`). */
export type ItemDaFila = { id: string; texto: string; podeCancelar: boolean };

type Props = {
  itens: ItemDaFila[];
  rotuloCancelar: string;
  onCancelar?: (id: string) => void;
  /** Cancelamento em voo (RN-673: não otimista): o botão fica inerte. */
  desabilitado?: boolean;
};

export function Queue({ itens, rotuloCancelar, onCancelar, desabilitado }: Props) {
  return (
    <Trace data-slot="ai-queue">
      {itens.map((it) => (
        <div key={it.id} className="flex items-center gap-2">
          <TraceLine status="pending">
            <TraceIcon><ClockIcon /></TraceIcon>
            <TraceTitle>{it.texto}</TraceTitle>
          </TraceLine>
          {it.podeCancelar && onCancelar && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={rotuloCancelar} disabled={desabilitado} onClick={() => onCancelar(it.id)}>
              <XIcon />
            </Button>
          )}
        </div>
      ))}
    </Trace>
  );
}

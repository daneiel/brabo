import { Button } from '@/components/shadcn/button';

type Props = {
  sugestoes: string[];
  onEscolher: (texto: string) => void;
  desabilitado?: boolean;
};

/** Padrão Suggestion: chips que devolvem o texto; o chamador decide o que fazer. */
export function Sugestoes({ sugestoes, onEscolher, desabilitado }: Props) {
  if (sugestoes.length === 0) return null;
  return (
    <div data-slot="suggestions" className="flex flex-wrap gap-2">
      {sugestoes.map((s) => (
        <Button
          key={s}
          type="button"
          variant="outline"
          size="sm"
          disabled={desabilitado}
          onClick={() => onEscolher(s)}
        >
          {s}
        </Button>
      ))}
    </div>
  );
}
